import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "./index.css";
import App from "./App.tsx";
import Admin from "./Admin.tsx";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error(
    "Missing VITE_CONVEX_URL. For local: run `npx convex dev`. For Vercel: set CONVEX_DEPLOY_KEY and use the vercel.json build command.",
  );
}

const convex = new ConvexReactClient(convexUrl);

function subscribePath(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getPath() {
  return window.location.pathname;
}

function Root() {
  const path = useSyncExternalStore(subscribePath, getPath, () => "/");
  if (path === "/admin" || path.startsWith("/admin/")) {
    return <Admin />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <Root />
    </ConvexProvider>
  </StrictMode>,
);
