// Local browser tests only: real auth routes and Argon2, ephemeral store/mail capture.
import { buildApp } from "../../api/src/app.ts";
import { loadConfig } from "../../api/src/config.ts";
import { createArgon2Hasher } from "../../api/src/modules/auth/crypto.ts";
import { createMemoryAuthStore } from "../../api/test/support/memory-store.ts";
if (process.env.NODE_ENV === "production") throw new Error("Test server is local only");
const mails=[];
const app=buildApp({
  config:loadConfig({APP_ENV:"test",LOG_LEVEL:"silent",WEB_URL:"http://127.0.0.1:3002",API_URL:"http://127.0.0.1:4011",SESSION_COOKIE_SECURE:"false",AUTH_TOKEN_PEPPER:"web-browser-test-pepper-0123456789",MAIL_FROM:"test@localhost",MEDIA_PUBLIC_BASE_URL:"http://127.0.0.1:4011/media"}),
  authStore:createMemoryAuthStore(),
  rbacStore:{
    grants:async()=>({roles:[],sanctions:[]}),
    moderatedCommunityIds:async()=>[],
  },
  hasher:createArgon2Hasher(),mailer:{send:async mail=>{mails.push(mail);}},logger:false,
});
app.get("/__test__/mail",async()=>({text:mails.at(-1)?.text??""}));
await app.listen({host:"127.0.0.1",port:4011});
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,async()=>{await app.close();process.exit(0);});
