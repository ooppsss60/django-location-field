from django.apps import AppConfig
from django.conf import settings
from django.templatetags.static import static

from location_field.settings import LOCATION_FIELD


class DefaultConfig(AppConfig):
    name = "location_field"
    verbose_name = "Location Field"

    def ready(self):
        self.patch_settings()

    def patch_settings(self):
        user_config = getattr(settings, "LOCATION_FIELD", {})
        config = LOCATION_FIELD.copy()
        config.update(user_config)

        if "resources.root_path" not in user_config:
            config["resources.root_path"] = static("location_field").rstrip("/")

        user_media = user_config.get("resources.media", {})
        media = config.get("resources.media", {}).copy()
        if "js" not in user_media:
            media["js"] = [static("location_field/js/form.js")]
        config["resources.media"] = media

        settings.LOCATION_FIELD = config
