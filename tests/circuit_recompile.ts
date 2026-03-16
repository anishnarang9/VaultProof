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

describe("circuit recompile", function () {
  this.timeout(600000);

  it("covers the recompiled circuit contract", () => {
    run("node", ["circuits/test_recompile.mjs"]);
  });
});
