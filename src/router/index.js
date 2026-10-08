import { createRouter, createWebHistory } from "vue-router";
import { Capacitor } from "@capacitor/core";
import { managementRedirect } from "../domain/subscriptionManagement.js";
import {
  AUTH_LOGIN_REQUIRED_EVENT,
  isLoggedIn,
  getUser,
} from "../services/backendSync";

const routes = [
  { path: "/superadmin/agents", name: "AgentManagement", component: () => import("../views/SubscriptionManagementView.vue"), meta: { requiresAuth: true, salesRole: "superadmin", salesKind: "agents" } },
  { path: "/agent/customers", name: "IndividualCustomers", component: () => import("../views/SubscriptionManagementView.vue"), meta: { requiresAuth: true, salesRole: "agent", salesKind: "customers" } },
  { path: "/agent/customers/:customerId", name: "IndividualCustomerHistory", component: () => import("../views/SubscriptionManagementView.vue"), meta: { requiresAuth: true, salesRole: "agent", salesKind: "history" } },
  { path: "/management-unavailable", name: "ManagementUnavailable", component: () => import("../views/ManagementUnavailableView.vue"), meta: { managementBlocked: true } },
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/LoginView.vue"),
    meta: { guest: true }, // sadece giriş yapmamışlar görebilir
  },
  {
    path: "/",
    name: "Home",
    component: () => import("../views/HomeView.vue"),
    meta: {}, // Standalone is available without an online login.
  },
  {
    path: "/settings",
    name: "Settings",
    component: () => import("../views/SettingsView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/manager",
    name: "Manager",
    component: () => import("../views/ManagerView.vue"),
    meta: { requiresAuth: true, requiresRole: ["manager", "superadmin"] },
  },
  {
    path: "/superadmin",
    name: "SuperAdmin",
    component: () => import("../views/SuperAdminView.vue"),
    meta: { requiresAuth: true, requiresRole: ["superadmin"] },
  },
  {
    path: "/profile",
    name: "Profile",
    component: () => import("../views/ProfileView.vue"),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Auth guard
router.beforeEach((to) => {
  const redirect = managementRedirect(to, { loggedIn: isLoggedIn(), user: getUser(), native: Capacitor.getPlatform() !== 'web' || Capacitor.isNativePlatform() });
  if (redirect) return redirect;
  if (to.meta.requiresAuth && !isLoggedIn()) {
    return "/login";
  } else if (to.meta.guest && isLoggedIn()) {
    return "/";
  } else if (to.meta.requiresRole) {
    const user = getUser();
    if (!user || !to.meta.requiresRole.includes(user.role)) {
      return "/";
    }
  }
});

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_LOGIN_REQUIRED_EVENT, () => {
    router.replace("/login");
  });
}

export default router;
