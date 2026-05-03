from django.urls import path
from .views import interview_start, interview_respond, interview_finalize, interview_override, sliders_save

urlpatterns = [
    path("personality/interview/start/",    interview_start,    name="personality-interview-start"),
    path("personality/interview/respond/",  interview_respond,  name="personality-interview-respond"),
    path("personality/interview/finalize/", interview_finalize, name="personality-interview-finalize"),
    path("personality/interview/override/", interview_override, name="personality-interview-override"),
    path("personality/sliders/",            sliders_save,       name="personality-sliders"),
]
