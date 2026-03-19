import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

// ─── Password regex ──────────────────────────────────────────────────────────
// At least 8 chars, one uppercase, one lowercase, one digit, one special char.
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
const PASSWORD_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";

// ─── Gender enum (matches Prisma) ─────────────────────────────────────────────
export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  PREFER_NOT_TO_SAY = "PREFER_NOT_TO_SAY",
}

// ─── Custom validator: passwords must match ───────────────────────────────────
@ValidatorConstraint({ name: "matchesField", async: false })
class MatchesFieldConstraint implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments) {
    const relatedField = args.constraints[0] as string;
    const relatedValue = (args.object as Record<string, unknown>)[
      relatedField
    ];
    return value === relatedValue;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must match ${args.constraints[0]}.`;
  }
}

// ─── Custom validator: user must be at least 13 years old ─────────────────────
@ValidatorConstraint({ name: "isAdult13", async: false })
class IsAdult13Constraint implements ValidatorConstraintInterface {
  validate(value: string) {
    const dob = new Date(value);
    if (isNaN(dob.getTime())) return false;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age >= 13;
  }

  defaultMessage() {
    return "You must be at least 13 years old to register.";
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 1: Register
// ══════════════════════════════════════════════════════════════════════════════
export class RegisterDto {
  @IsEmail({}, { message: "Please provide a valid email address." })
  @MaxLength(255)
  email!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password!: string;

  @IsString()
  @Validate(MatchesFieldConstraint, ["password"])
  password_confirm!: string;

  @IsString()
  @MinLength(2, { message: "Display name must be between 2 and 50 characters." })
  @MaxLength(50, { message: "Display name must be between 2 and 50 characters." })
  display_name!: string;

  @IsDateString({}, { message: "Date of birth must be a valid ISO date (YYYY-MM-DD)." })
  @Validate(IsAdult13Constraint)
  date_of_birth!: string;

  @IsEnum(Gender, { message: "Gender must be one of: MALE, FEMALE, PREFER_NOT_TO_SAY." })
  gender!: Gender;

  @IsOptional()
  @IsString()
  captcha_token?: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 2: Verify Email (query param)
// ══════════════════════════════════════════════════════════════════════════════
export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty({ message: "Verification token is required." })
  token!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 3: Resend Verification
// ══════════════════════════════════════════════════════════════════════════════
export class ResendVerificationDto {
  @IsEmail({}, { message: "Please provide a valid email address." })
  email!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 4: Login
// ══════════════════════════════════════════════════════════════════════════════
export class LoginDto {
  @IsEmail({}, { message: "Please provide a valid email address." })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: "Password is required." })
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember_me?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 10: Forgot Password
// ══════════════════════════════════════════════════════════════════════════════
export class ForgotPasswordDto {
  @IsEmail({}, { message: "Please provide a valid email address." })
  email!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 11: Reset Password
// ══════════════════════════════════════════════════════════════════════════════
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: "Reset token is required." })
  token!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  new_password!: string;

  @IsString()
  @Validate(MatchesFieldConstraint, ["new_password"])
  new_password_confirm!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 12: Change Password
// ══════════════════════════════════════════════════════════════════════════════
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: "Current password is required." })
  current_password!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  new_password!: string;

  @IsString()
  @Validate(MatchesFieldConstraint, ["new_password"])
  new_password_confirm!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 13: Request Email Change
// ══════════════════════════════════════════════════════════════════════════════
export class RequestEmailChangeDto {
  @IsEmail({}, { message: "Please provide a valid email address." })
  new_email!: string;

  @IsString()
  @IsNotEmpty({ message: "Current password is required." })
  current_password!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 14: Confirm Email Change
// ══════════════════════════════════════════════════════════════════════════════
export class ConfirmEmailChangeDto {
  @IsString()
  @IsNotEmpty({ message: "Confirmation token is required." })
  token!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 17: Revoke Session (path param)
// ══════════════════════════════════════════════════════════════════════════════
export class RevokeSessionParamsDto {
  @IsUUID("4", { message: "Session ID must be a valid UUID." })
  sessionId!: string;
}
