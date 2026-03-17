import { execFileSync } from "child_process";
const ROOT = "/Users/anishnarang/VaultProof";

function run(command: string, args: string[]) {
  try {
    execFileSync(command, args, {
      cwd: ROOT,
      stdio: "pipe",
    });
  } catch (error: any) {
    const stdout = error.stdout?.toString() ?? "";
    const stderr = error.stderr?.toString() ?? "";
    throw new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`.trim());
  }
}

describe("strict verifier", function () {
  this.timeout(600000);

  it("runs the vusd-vault strict verifier unit tests", () => {
    run("cargo", ["test", "-p", "vusd-vault", "strict_", "--", "--nocapture"]);
  });

  it("runs the vusd-vault risk control unit tests", () => {
    run("cargo", ["test", "-p", "vusd-vault", "risk_", "--", "--nocapture"]);
  });

  it("runs the vusd-vault admin update unit tests", () => {
    run("cargo", ["test", "-p", "vusd-vault", "admin_", "--", "--nocapture"]);
  });

  it("runs the vusd-vault custody unit tests", () => {
    run("cargo", ["test", "-p", "vusd-vault", "custody_", "--", "--nocapture"]);
  });

  it("runs the compliance-admin decryption authorization unit tests", () => {
    run("cargo", ["test", "-p", "compliance-admin", "decryption_", "--", "--nocapture"]);
  });
});
