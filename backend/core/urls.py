from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PropertyViewSet, PanoramaUploadView

router = DefaultRouter()
router.register(r"properties", PropertyViewSet, basename="property")

urlpatterns = [
    path("", include(router.urls)),
    path("panoramas/upload/", PanoramaUploadView.as_view(), name="panorama-upload"),
]
