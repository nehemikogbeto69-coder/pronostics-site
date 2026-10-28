/**
 * Vérification PNG : c'est le contrat central de l'application
 * (« ne jamais annoncer un export réussi qui ne l'est pas »).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PNG_SIGNATURE,
  hasIend,
  hasPngSignature,
  parsePngIhdr,
  toBytes,
  verifyDecodable,
  verifyPngBytes,
} from "../src/io/png.js";
import { canvasFactory, decodePng, makeCanvas, pngBytes } from "./helpers/headless.mjs";

test("un PNG produit par le canvas est reconnu comme valide", async () => {
  const canvas = canvasFactory(1280, 720);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#7c3aed";
  ctx.fillRect(0, 0, 1280, 720);
  const bytes = toBytes(await pngBytes(canvas));

  assert.ok(hasPngSignature(bytes));
  const info = parsePngIhdr(bytes);
  assert.equal(info.width, 1280);
  assert.equal(info.height, 720);
  assert.ok(info.bitDepth === 8);
  assert.ok([2, 6].includes(info.colorType), `colorType inattendu : ${info.colorType}`);
  assert.ok(hasIend(bytes));

  const result = verifyPngBytes(bytes, { width: 1280, height: 720 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("la signature PNG est refusée pour un JPEG", () => {
  const jpeg = toBytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(hasPngSignature(jpeg), false);
  assert.equal(parsePngIhdr(jpeg), null);
  const result = verifyPngBytes(jpeg, { width: 1280, height: 720 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /PNG/);
});

test("un PNG tronqué est détecté (IEND manquant)", async () => {
  const canvas = canvasFactory(64, 32);
  canvas.getContext("2d").fillRect(0, 0, 64, 32);
  const bytes = toBytes(await pngBytes(canvas));
  const truncated = bytes.slice(0, bytes.length - 16);

  assert.equal(hasIend(truncated), false);
  const result = verifyPngBytes(truncated, { width: 64, height: 32 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /IEND/.test(e)));
});

test("des dimensions inattendues sont signalées", async () => {
  const canvas = canvasFactory(800, 450);
  canvas.getContext("2d").fillRect(0, 0, 800, 450);
  const bytes = toBytes(await pngBytes(canvas));

  const result = verifyPngBytes(bytes, { width: 1280, height: 720 });
  assert.equal(result.ok, false);
  assert.equal(result.info.width, 800);
  assert.ok(result.errors.some((e) => /1280/.test(e)));
  assert.ok(result.errors.some((e) => /720/.test(e)));
});

test("un buffer vide ne passe jamais la vérification", () => {
  const result = verifyPngBytes(new Uint8Array(0), { width: 1280, height: 720 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("décodage réel de l'image produite", async () => {
  const canvas = canvasFactory(1280, 720);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0614";
  ctx.fillRect(0, 0, 1280, 720);
  const bytes = toBytes(await pngBytes(canvas));

  const decoded = await verifyDecodable(bytes, { decode: decodePng });
  assert.equal(decoded.checked, true);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.width, 1280);
  assert.equal(decoded.height, 720);
});

test("décodage refusé pour des octets invalides", async () => {
  const decoded = await verifyDecodable(toBytes([1, 2, 3, 4, 5, 6, 7, 8, 9]), {
    decode: decodePng,
  });
  assert.equal(decoded.checked, true);
  assert.equal(decoded.ok, false);
});

test("la signature attendue correspond à la norme PNG", () => {
  assert.deepEqual(PNG_SIGNATURE, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("toBytes accepte ArrayBuffer, Buffer et tableaux", () => {
  const buffer = new Uint8Array([9, 8, 7]).buffer;
  assert.deepEqual([...toBytes(buffer)], [9, 8, 7]);
  assert.deepEqual([...toBytes(Buffer.from([1, 2, 3]))], [1, 2, 3]);
  assert.deepEqual([...toBytes([4, 5, 6])], [4, 5, 6]);
  assert.equal(toBytes(null).length, 0);
});

test("un canvas aux dimensions incohérentes est refusé", async () => {
  const canvas = makeCanvas(1, 1);
  canvas.getContext("2d").fillRect(0, 0, 1, 1);
  const bytes = toBytes(await pngBytes(canvas));
  const result = verifyPngBytes(bytes, { width: 1280, height: 720 });
  assert.equal(result.ok, false);
  assert.equal(result.info.width, 1);
});
