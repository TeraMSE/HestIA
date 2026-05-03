from rest_framework import serializers
from djoser.serializers import UserCreateSerializer as DjoserUserCreateSerializer
from .models import CustomUser


class CustomUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = (
            "id", "email", "first_name", "last_name", "role", "verified_email", "created_at",
            # Living preferences (optional — settable via PATCH /auth/users/me/)
            "bio", "noise_tolerance", "cleanliness", "thermal_sensitivity", "smoker", "daily_schedule",
        )
        read_only_fields = ("id", "created_at", "verified_email")

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        print(f"DEBUG: Serializing user {instance.email}. Role: {ret.get('role')}")
        return ret


class CustomUserCreateSerializer(DjoserUserCreateSerializer):
    """
    Extends Djoser's base UserCreateSerializer so the Djoser view layer
    correctly picks it up.  Adds the `role` field and auto-sets username=email.
    """
    role = serializers.ChoiceField(choices=CustomUser.ROLE_CHOICES, required=True)

    class Meta(DjoserUserCreateSerializer.Meta):
        model = CustomUser
        # re_password is not needed because USER_CREATE_PASSWORD_RETYPE is False
        fields = ("email", "first_name", "last_name", "password", "role")

    def perform_create(self, validated_data):
        """Djoser calls this with **validated_data; inject username=email."""
        validated_data["username"] = validated_data["email"]
        return CustomUser.objects.create_user(**validated_data)
