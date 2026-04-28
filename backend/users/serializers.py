from rest_framework import serializers
from .models import CustomUser


class CustomUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ("id", "email", "first_name", "last_name", "role", "verified_email", "created_at")
        read_only_fields = ("id", "created_at", "verified_email")


class CustomUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True, style={"input_type": "password"})
    password2 = serializers.CharField(write_only=True, required=True, style={"input_type": "password"}, label="Confirm password")
    role = serializers.ChoiceField(choices=CustomUser.ROLE_CHOICES, required=True)

    class Meta:
        model = CustomUser
        fields = ("email", "first_name", "last_name", "password", "password2", "role")

    def validate(self, data):
        if data["password"] != data.pop("password2"):
            raise serializers.ValidationError({"password": "Passwords do not match."})
        return data

    def create(self, validated_data):
        user = CustomUser.objects.create_user(
            username=validated_data["email"],
            email=validated_data["email"],
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
            role=validated_data["role"],
        )
        return user
