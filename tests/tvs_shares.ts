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

describe("tokenized vault shares", function () {
  this.timeout(600000);

  it("runs the share-accounting unit tests", () => {
    run("cargo", ["test", "-p", "vusd-vault", "share_", "--", "--nocapture"]);
  });

  it("runs the yield-accounting unit tests", () => {
    run("cargo", ["test", "-p", "vusd-vault", "yield_", "--", "--nocapture"]);
  });
});
