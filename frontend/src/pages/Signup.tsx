import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore, type UserRole } from "@/shared/store/useAuthStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<UserRole>("renter");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { signup } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await signup(email, password, firstName, lastName, role);
      toast.success("Account created successfully!");
      navigate("/map");
    } catch {
      toast.error("Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">HestIA</h1>
        <p className="text-gray-600 mb-8">Create your account and find your perfect home.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor="role">I am a...</Label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              disabled={isLoading}
            >
              <option value="renter">Renter</option>
              <option value="buyer">Buyer</option>
              <option value="landlord">Landlord</option>
            </select>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creating account..." : "Sign up"}
          </Button>
        </form>

        <p className="text-center text-gray-600 mt-6">
          Already have an account?{" "}
          <button
            onClick={() => navigate("/login")}
            className="text-indigo-600 hover:underline font-medium"
          >
            Login
          </button>
        </p>
      </div>
    </div>
  );
}
