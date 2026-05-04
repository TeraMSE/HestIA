from django.urls import path
from . import views

app_name = "rag_assistant"

urlpatterns = [
    path("chat/", views.chat, name="chat"),
]
