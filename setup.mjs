import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const password = randomBytes(24).toString("base64url");
const contents = [
  "PORT=3000",
  "ADMIN_USERNAME=owner",
  `ADMIN_PASSWORD=${password}`,
  "COOKIE_SECURE=false",
  "",
].join("\n");

if (process.env.RENDER || (process.env.DATABASE_URL && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD)) {
  console.log("Using deployment environment settings.");
} else {
  try {
    writeFileSync(".env", contents, { flag: "wx", mode: 0o600 });
    console.log("Created a private .env file for the first run.");
    console.log("Staff sign-in username: owner");
    console.log(`Staff sign-in password: ${password}`);
    console.log("Save this password. It is stored locally in .env and will not be shown again.");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
