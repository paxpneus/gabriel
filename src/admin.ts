import { Express } from "express";
import sequelize from "./config/sequelize";

const loadESM = new Function("modulePath", "return import(modulePath)") as (
  modulePath: string,
) => Promise<any>;

export const setupAdminJS = async (app: Express) => {
  const { default: AdminJS, DefaultAuthProvider } = await loadESM("adminjs");

  const { default: AdminJSExpress } = await loadESM("@adminjs/express");

  const AdminJSSequelize = await loadESM("@adminjs/sequelize");

  AdminJS.registerAdapter({
    Database: AdminJSSequelize.Database,
    Resource: AdminJSSequelize.Resource,
  });

  const admin = new AdminJS({
    rootPath: "/dev-panel",
    loginPath: "/dev-panel/login",
    logoutPath: "/dev-panel/logout",
    databases: [sequelize],
  });

  if (process.env.NODE_ENV !== "production") {
    admin.watch();
  }

  const authProvider = new DefaultAuthProvider({
    componentLoader: admin.componentLoader,

    authenticate: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      const adminEmail = process.env.DB_USER || "admin@paxhub.com";
      const adminPassword = process.env.DB_PASS;

      if (!adminPassword) {
        console.warn("⚠️ DB_PASS não configurado");
        return null;
      }

      if (email === adminEmail && password === adminPassword) {
        return { email };
      }

      return null;
    },
  });

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      provider: authProvider,
      cookieName: "adminjs",
      cookiePassword:
        process.env.ADMIN_COOKIE_PASSWORD ||
        "uma-chave-longa-e-estatica-com-pelo-menos-32-caracteres",
    },
    null,
    {
      resave: false,
      saveUninitialized: true,
      secret:
        process.env.ADMIN_COOKIE_SECRET ||
        "uma-chave-longa-e-estatica-com-pelo-menos-32-caracteres",
      cookie: {
        secure: process.env.NODE_ENV === "production",
      },
    },
  );

  app.use(admin.options.rootPath, router);

  console.log("🚀 Painel AdminJS carregado em /dev-panel");
};
