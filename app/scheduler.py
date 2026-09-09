"""Planificateur : relance la synchronisation à intervalle régulier.

Utilise APScheduler en tâche de fond du processus FastAPI. Pas besoin de
cron système ni de systemd : le serveur s'occupe de tout seul de rester à jour.

Pour un déploiement en production avec plusieurs workers, il faudrait déplacer
ce déclenchement vers un cron externe (sinon chaque worker synchroniserait).
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from .config import SYNC_INTERVAL_MINUTES
from .sync import sync_all

log = logging.getLogger("prono.scheduler")

_scheduler: BackgroundScheduler | None = None


def _job() -> None:
    try:
        result = sync_all()
        log.info("sync planifiée terminée : %s", result)
    except Exception:
        log.exception("échec de la sync planifiée")


def start_scheduler(run_now: bool = True) -> BackgroundScheduler:
    """Démarre le planificateur. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _job,
        trigger=IntervalTrigger(minutes=SYNC_INTERVAL_MINUTES),
        id="sync_all",
        name=f"Synchronisation toutes les {SYNC_INTERVAL_MINUTES} min",
        max_instances=1,          # évite deux syncs concurrentes
        coalesce=True,            # plusieurs retards -> une seule exécution
        misfire_grace_time=300,
    )
    _scheduler.start()
    log.info("planificateur démarré (intervalle : %s min)", SYNC_INTERVAL_MINUTES)

    if run_now:
        # Premier sync immédiat, dans un thread à part pour ne pas bloquer le démarrage.
        _scheduler.add_job(_job, id="sync_initial", name="Sync initiale")
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def next_run_iso() -> str | None:
    if _scheduler is None:
        return None
    job = _scheduler.get_job("sync_all")
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None
