import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const apiDir = process.cwd();
const rootEnvPath = path.resolve(apiDir, "../../.env");
const apiEnvPath = path.resolve(apiDir, ".env");

loadEnvFile(rootEnvPath, false);
loadEnvFile(apiEnvPath, true);

function loadEnvFile(filePath: string, overrideLoadedValues: boolean) {
  if (!existsSync(filePath)) {
    return;
  }

  const parsed = dotenv.parse(readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || overrideLoadedValues) {
      process.env[key] = value;
    }
  }
}
