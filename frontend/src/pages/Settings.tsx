import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Save, User } from "lucide-react";
import api from "@/services/api";
import { useAuthStore } from "@/shared/store/useAuthStore";

export default function Settings() {
  const navigate = useNavigate();
  const { user, initializeAuth } = useAuthStore();

  const [form, setForm] = useState({
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    bio: user?.bio ?? "",
    noise_tolerance: user?.noise_tolerance ?? 50,
    cleanliness: user?.cleanliness ?? 50,
    thermal_sensitivity: user?.thermal_sensitivity ?? 50,
    smoker: user?.smoker ?? false,
    daily_schedule: user?.daily_schedule ?? "flexible",
  });
  const [saving, setSaving] = useState(false);

  // Re-sync if user object loads after mount
  useEffect(() => {
    if (user) {
      setForm({
        first_name: user.first_name ?? "",
        last_name: user.last_name ?? "",
        bio: user.bio ?? "",
        noise_tolerance: user.noise_tolerance ?? 50,
        cleanliness: user.cleanliness ?? 50,
        thermal_sensitivity: user.thermal_sensitivity ?? 50,
        smoker: user.smoker ?? false,
        daily_schedule: user.daily_schedule ?? "flexible",
      });
    }
  }, [user?.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch("/auth/users/me/", {
        first_name: form.first_name,
        last_name: form.last_name,
        bio: form.bio,
        noise_tolerance: form.noise_tolerance,
        cleanliness: form.cleanliness,
        thermal_sensitivity: form.thermal_sensitivity,
        smoker: form.smoker,
        daily_schedule: form.daily_schedule,
      });
      // Update cached user in localStorage
      const updated = { ...user, ...res.data };
      localStorage.setItem("user", JSON.stringify(updated));
      initializeAuth();
      toast.success("Settings saved!");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Please log in to access settings.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Account Info */}
          <Card className="rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Account Info</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name</Label>
                <Input
                  value={form.first_name}
                  onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                  className="rounded-2xl mt-1"
                />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input
                  value={form.last_name}
                  onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                  className="rounded-2xl mt-1"
                />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input value={user.email} readOnly className="rounded-2xl mt-1 opacity-60" />
            </div>
            <div>
              <Label>Role</Label>
              <Input value={user.role} readOnly className="rounded-2xl mt-1 opacity-60 capitalize" />
            </div>
          </Card>

          {/* About Me */}
          <Card className="rounded-3xl p-6 space-y-4">
            <h2 className="font-semibold">About Me</h2>
            <div>
              <Label>Short Bio <span className="text-muted-foreground text-xs">(max 500 chars)</span></Label>
              <textarea
                value={form.bio}
                onChange={e => setForm(f => ({ ...f, bio: e.target.value.slice(0, 500) }))}
                rows={3}
                placeholder="Tell potential roommates a bit about yourself…"
                className="w-full mt-1 rounded-2xl bg-muted border border-border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground text-right mt-1">{form.bio.length}/500</p>
            </div>
          </Card>

          {/* Living Preferences */}
          <Card className="rounded-3xl p-6 space-y-5">
            <h2 className="font-semibold">Living Preferences</h2>
            <p className="text-xs text-muted-foreground">These will be used to pre-fill your Persona Builder.</p>

            {[
              { key: "noise_tolerance", label: "Noise Tolerance", desc: "Low = prefer quiet, High = fine with noise" },
              { key: "cleanliness", label: "Cleanliness", desc: "How tidy you keep shared spaces" },
              { key: "thermal_sensitivity", label: "Thermal Sensitivity", desc: "Low = comfortable with heat, High = needs precise temperature" },
            ].map(({ key, label, desc }) => (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground">{(form as any)[key]}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{desc}</p>
                <Slider
                  value={[(form as any)[key]]}
                  min={0} max={100} step={1}
                  onValueChange={v => setForm(f => ({ ...f, [key]: v[0] }))}
                />
              </div>
            ))}

            <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
              <div>
                <Label>Smoker</Label>
                <p className="text-xs text-muted-foreground">Do you smoke?</p>
              </div>
              <Switch
                checked={form.smoker}
                onCheckedChange={v => setForm(f => ({ ...f, smoker: v }))}
              />
            </div>

            <div>
              <Label>Daily Schedule</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {(["early_bird", "flexible", "night_owl"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setForm(f => ({ ...f, daily_schedule: s }))}
                    className={`rounded-full px-4 py-1.5 text-sm border-2 transition-colors ${
                      form.daily_schedule === s
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Button onClick={handleSave} disabled={saving} className="w-full rounded-2xl h-11">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
