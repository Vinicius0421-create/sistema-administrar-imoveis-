import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/App";
import { AuthProvider } from "../src/auth/AuthContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
