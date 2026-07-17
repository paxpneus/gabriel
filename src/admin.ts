// src/admin.ts
import { Express } from "express";
import sequelize from "./config/sequelize";

export const setupAdminJS = async (app: Express) => {
  const { default: AdminJS, DefaultAuthProvider } = await import("adminjs");
  const { default: AdminJSExpress } = await import("@adminjs/express");
  const AdminJSSequelize = await import("@adminjs/sequelize");

  AdminJS.registerAdapter({
    Database: AdminJSSequelize.Database,
    Resource: AdminJSSequelize.Resource,
  });

  const adminOptions = {
    databases: [sequelize],
    rootPath: "/admin",
  };

  const admin = new AdminJS(adminOptions);

  if (process.env.NODE_ENV !== "production") {
    admin.watch();
  }

  const authProvider = new DefaultAuthProvider({
    componentLoader: admin.componentLoader,
    authenticate: async ({ email, password }) => {

      const adminEmail = process.env.DB_USER || "admin@paxhub.com";
      const adminPassword = process.env.DB_PASS;

      if (!adminPassword) {
        console.warn("⚠️ DB_PASS não configurado no arquivo .env!");
        return null;
      }

      if (email === adminEmail && password === adminPassword) {
        console.log("✅ [ADMINJS] Usuário autenticado!");
        return { email };
      }

      console.log("❌ [ADMINJS] Credenciais incorretas.");
      return null;
    },
  });

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      provider: authProvider,
      cookieName: "adminjs",
      cookiePassword: process.env.ADMIN_COOKIE_PASSWORD || "uma-chave-longa-e-estatica-com-pelo-menos-32-caracteres",
    },
    null,
    {
      resave: false,
      saveUninitialized: true,
      secret: process.env.ADMIN_COOKIE_SECRET || "uma-chave-longa-e-estatica-com-pelo-menos-32-caracteres",
      cookie: {
        secure: process.env.NODE_ENV === "production",
      }
    }
  );

  app.use(admin.options.rootPath, router);

  console.log(`🚀 Painel AdminJS carregado em: /admin`);
};