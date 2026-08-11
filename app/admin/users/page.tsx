"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Shield, 
  Key, 
  User as UserIcon, 
  AlertCircle 
} from "lucide-react";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  pages?: string[];
  lastLoginAt?: string | null;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to load users");
        return;
      }
      setUsers(data.users || []);
    } catch (err) {
      setError("An error occurred while fetching users.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const session = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = await session.json().catch(() => ({}));
        const canAdmin = sessionData?.user?.role === "admin" || (Array.isArray(sessionData?.user?.pages) && sessionData.user.pages.includes("admin"));
      if (!session.ok || !canAdmin) {
          router.replace("/dashboard");
          return;
        }
        await load();
      } catch (err) {
        setError("Failed to authenticate session.");
        setIsLoading(false);
      }
    })();
  }, [router]);

  const setRole = async (id: string, role: string) => {
    try {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Failed to update role");
        return;
      }
      await load(); // Reload users to reflect changes
    } catch (err) {
      setError("An error occurred while updating the role.");
    }
  };

  // Filter based on search query and role chips
  const filteredUsers = users.filter((user) => {
    const matchesRole = filterRole === "all" || user.role === filterRole;
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch =
      (user.name || "").toLowerCase().includes(searchLower) ||
      (user.email || "").toLowerCase().includes(searchLower);

    return matchesRole && matchesSearch;
  });

  if (isLoading) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />

        <main className="flex-1 lg:ml-64 overflow-auto">
          <div className="p-6 lg:p-12">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
              <div>
                <Skeleton className="h-12 w-72 mb-3" />
                <Skeleton className="h-5 w-96" />
              </div>
              <Skeleton className="h-11 w-48 rounded-lg" />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mb-8 mt-8">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-32 rounded-lg" />
            </div>

            <div className="flex gap-2 mb-8 flex-wrap">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-24 rounded-full" />
              ))}
            </div>

            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="p-4 border border-border bg-card">
                  <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                      </div>
                    </div>
                    <div className="hidden md:flex items-center gap-8 w-full sm:w-auto mt-4 sm:mt-0">
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-4 w-12" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-24 rounded-full" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
              <div>
                <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">User Management</h1>
                <p className="text-muted-foreground">Manage all system users and permissions shortcuts</p>
              </div>
              <Button asChild className="bg-foreground hover:bg-foreground/90 text-background px-6 rounded-lg whitespace-nowrap">
                <Link href="/admin/permissions">
                  Open Global Permissions
                </Link>
              </Button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 flex items-center gap-2 p-4 text-sm text-destructive bg-destructive/10 rounded-lg border border-destructive/20">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Search and filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>
            <Button variant="outline" className="border-border hover:bg-accent/10 gap-2 whitespace-nowrap">
              <Filter className="w-4 h-4" />
              More Filters
            </Button>
          </div>

          {/* Role filter chips */}
          <div className="flex gap-2 mb-8 flex-wrap">
            {[
              { id: "all", label: "All Users" },
              { id: "admin", label: "Admins" },
              { id: "user", label: "Regular Users" },
            ].map((status) => (
              <button
                key={status.id}
                onClick={() => setFilterRole(status.id)}
                className={`px-4 py-2 rounded-full text-sm transition-colors ${
                  filterRole === status.id
                    ? "bg-foreground text-background"
                    : "bg-secondary text-foreground hover:bg-secondary/80"
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>

          {/* Users table */}
          <div className="space-y-3">
            {!isLoading && filteredUsers.length === 0 && (
              <Card className="p-8 text-center text-muted-foreground border-dashed">
                {searchQuery ? "No users match your search." : "No users found."}
              </Card>
            )}

            {filteredUsers.map((user) => (
              <Card
                key={user.id}
                className="p-4 border border-border bg-card hover:bg-accent/5 transition-colors group"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                  {/* User info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-sidebar rounded-full flex items-center justify-center flex-shrink-0 font-medium text-foreground">
                        {(user.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{user.name}</h3>
                          {user.role === "admin" && (
                            <Shield className="w-4 h-4 text-orange-600 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="hidden md:flex items-center gap-8 text-sm w-full sm:w-auto mt-4 sm:mt-0">
                    <div className="text-right">
                      <p className="text-muted-foreground text-xs">Pages Access</p>
                      <p className="font-mono font-semibold truncate max-w-[120px]" title={(user.pages || []).join(", ")}>
                        {(user.pages && user.pages.length > 0) ? user.pages.length : "0"}
                      </p>
                    </div>
                    <div className="text-right w-24">
                      <p className="text-muted-foreground text-xs">Last Login</p>
                      <p className="font-mono text-xs truncate">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
                      </p>
                    </div>
                  </div>

                  {/* Role Badge */}
                  <div className={`px-3 py-1 rounded-full text-xs font-mono whitespace-nowrap ${
                    user.role === "admin"
                      ? "bg-orange-500/10 text-orange-700"
                      : "bg-blue-500/10 text-blue-700"
                  }`}>
                    {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {user.role === "admin" ? (
                      <button 
                        onClick={() => setRole(user.id, "user")}
                        className="p-2 hover:bg-blue-500/10 rounded transition-colors" 
                        title="Demote to User"
                      >
                        <UserIcon className="w-4 h-4 text-blue-600" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => setRole(user.id, "admin")}
                        className="p-2 hover:bg-orange-500/10 rounded transition-colors" 
                        title="Promote to Admin"
                      >
                        <Shield className="w-4 h-4 text-orange-600" />
                      </button>
                    )}
                    
                    <Link href={`/admin/permissions?userId=${user.id}`}>
                      <button className="p-2 hover:bg-accent/10 rounded transition-colors" title="Manage Permissions">
                        <Key className="w-4 h-4" />
                      </button>
                    </Link>
                    
                    <button className="p-2 hover:bg-accent/10 rounded transition-colors text-muted-foreground">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {!isLoading && users.length > 0 && (
            <div className="mt-8 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {filteredUsers.length} of {users.length} users
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="border-border hover:bg-accent/10" disabled>
                  Previous
                </Button>
                <Button variant="outline" className="border-border hover:bg-accent/10" disabled>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}