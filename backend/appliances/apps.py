import logging
from django.apps import AppConfig

logger = logging.getLogger(__name__)


class AppliancesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "appliances"

    def ready(self):
        from django.conf import settings
        model_path = getattr(settings, "APPLIANCE_CNN_PATH", None)
        if model_path and model_path.is_file():
            try:
                from .services.agent import get_agent
                get_agent()
                logger.info("[appliances] ApplianceVisionAgent loaded and cached.")
            except Exception as exc:
                logger.warning(f"[appliances] Could not pre-load agent: {exc}")
        else:
            logger.warning(
                "[appliances] APPLIANCE_CNN_PATH not set or model file missing — "
                "agent will be initialized on first request."
            )
