import { validate } from "class-validator";
import { SetupPasswordDto } from "./auth.dto";

describe("SetupPasswordDto", () => {
  it("rejects weak password", async () => {
    const dto = new SetupPasswordDto();
    dto.newPassword = "weak";
    dto.confirmPassword = "weak";

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain("Password must be at least 8 characters");
  });

  it("rejects mismatched confirmation", async () => {
    const dto = new SetupPasswordDto();
    dto.newPassword = "StrongP@ssw0rd";
    dto.confirmPassword = "StrongP@ssw0rdX";

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain("confirmPassword");
  });
});
