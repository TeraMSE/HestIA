"""DRF serializers for SocialSimRun."""

from rest_framework import serializers

from .models import SocialSimRun


class SocialSimRunSerializer(serializers.ModelSerializer):
    """Read serializer — for status polling and detail views."""

    class Meta:
        model = SocialSimRun
        fields = [
            "id",
            "status",
            "progress",
            "created_at",
            "updated_at",
            "property_id",
            "compatibility_score",
            "error",
        ]


class SocialSimRunCreateSerializer(serializers.ModelSerializer):
    """Write serializer — for creating a new run."""

    class Meta:
        model = SocialSimRun
        fields = [
            "persona_a",
            "persona_b",
            "apartment_layout",
            "environment_state",
            "property_id",
        ]

    def validate_persona_a(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("persona_a must be a JSON object.")
        required = ["subject_id", "name"]
        for key in required:
            if key not in value:
                raise serializers.ValidationError(f"persona_a missing required field: {key}")
        return value


class SocialSimRunReplaySerializer(serializers.ModelSerializer):
    """Serializer for the full replay payload."""

    class Meta:
        model = SocialSimRun
        fields = ["id", "status", "result"]


class SocialSimRunMediationSerializer(serializers.ModelSerializer):
    """Serializer for mediation rules."""

    class Meta:
        model = SocialSimRun
        fields = ["id", "status", "mediation_rules", "mediation_summary", "compatibility_score"]
