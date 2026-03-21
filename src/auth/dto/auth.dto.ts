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
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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
  @ApiProperty({ example: "user@example.com", description: "User email address" })
  @IsEmail({}, { message: "Please provide a valid email address." })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: "Passw0rd!", description: "Min 8 chars, uppercase, lowercase, digit, special char" })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password!: string;

  @ApiProperty({ example: "Passw0rd!", description: "Must match password" })
  @IsString()
  @Validate(MatchesFieldConstraint, ["password"])
  password_confirm!: string;

  @ApiProperty({ example: "John Doe", description: "Display name (2–50 characters)" })
  @IsString()
  @MinLength(2, { message: "Display name must be between 2 and 50 characters." })
  @MaxLength(50, { message: "Display name must be between 2 and 50 characters." })
  display_name!: string;

  @ApiProperty({ example: "2000-01-15", description: "Date of birth in YYYY-MM-DD format. Must be 13+ years old." })
  @IsDateString({}, { message: "Date of birth must be a valid ISO date (YYYY-MM-DD)." })
  @Validate(IsAdult13Constraint)
  date_of_birth!: string;

  @ApiProperty({ enum: Gender, example: Gender.PREFER_NOT_TO_SAY, description: "Gender selection" })
  @IsEnum(Gender, { message: "Gender must be one of: MALE, FEMALE, PREFER_NOT_TO_SAY." })
  gender!: Gender;

  @ApiPropertyOptional({ example: "03AGdBq...", description: "Google reCAPTCHA v3 token (required in production)" })
  @IsOptional()
  @IsString()
  captcha_token?: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 2: Verify Email (query param)
// ══════════════════════════════════════════════════════════════════════════════
export class VerifyEmailDto {
  @ApiProperty({ example: "a1b2c3d4e5f6...", description: "Email verification token from the link in the verification email" })
  @IsString()
  @IsNotEmpty({ message: "Verification token is required." })
  token!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 3: Resend Verification
// ══════════════════════════════════════════════════════════════════════════════
export class ResendVerificationDto {
  @ApiProperty({ example: "user@example.com", description: "Email address to resend the verification link to" })
  @IsEmail({}, { message: "Please provide a valid email address." })
  email!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 4: Login
// ══════════════════════════════════════════════════════════════════════════════
export class LoginDto {
  @ApiProperty({ example: "user@example.com", description: "Registered email address" })
  @IsEmail({}, { message: "Please provide a valid email address." })
  email!: string;

  @ApiProperty({ example: "Passw0rd!", description: "Account password" })
  @IsString()
  @IsNotEmpty({ message: "Password is required." })
  password!: string;

  @ApiPropertyOptional({ example: true, description: "If true, refresh token lifetime is extended to 30 days" })
  @IsOptional()
  @IsBoolean()
  remember_me?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 10: Forgot Password
// ══════════════════════════════════════════════════════════════════════════════
export class ForgotPasswordDto {
  @ApiProperty({ example: "user@example.com", description: "Email address associated with the account" })
  @IsEmail({}, { message: "Please provide a valid email address." })
  email!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 11: Reset Password
// ══════════════════════════════════════════════════════════════════════════════
export class ResetPasswordDto {
  @ApiProperty({ example: "a1b2c3d4e5f6...", description: "Password reset token from the email link (valid for 1 hour)" })
  @IsString()
  @IsNotEmpty({ message: "Reset token is required." })
  token!: string;

  @ApiProperty({ example: "NewPassw0rd!", description: "New password — min 8 chars, uppercase, lowercase, digit, special char" })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  new_password!: string;

  @ApiProperty({ example: "NewPassw0rd!", description: "Must match new_password" })
  @IsString()
  @Validate(MatchesFieldConstraint, ["new_password"])
  new_password_confirm!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 12: Change Password
// ══════════════════════════════════════════════════════════════════════════════
export class ChangePasswordDto {
  @ApiProperty({ example: "OldPassw0rd!", description: "Current account password for verification" })
  @IsString()
  @IsNotEmpty({ message: "Current password is required." })
  current_password!: string;

  @ApiProperty({ example: "NewPassw0rd!", description: "New password — min 8 chars, uppercase, lowercase, digit, special char" })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  new_password!: string;

  @ApiProperty({ example: "NewPassw0rd!", description: "Must match new_password" })
  @IsString()
  @Validate(MatchesFieldConstraint, ["new_password"])
  new_password_confirm!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 13: Request Email Change
// ══════════════════════════════════════════════════════════════════════════════
export class RequestEmailChangeDto {
  @ApiProperty({ example: "newaddress@example.com", description: "The new email address to change to" })
  @IsEmail({}, { message: "Please provide a valid email address." })
  new_email!: string;

  @ApiProperty({ example: "Passw0rd!", description: "Current password to authorise the change" })
  @IsString()
  @IsNotEmpty({ message: "Current password is required." })
  current_password!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 14: Confirm Email Change
// ══════════════════════════════════════════════════════════════════════════════
export class ConfirmEmailChangeDto {
  @ApiProperty({ example: "a1b2c3d4e5f6...", description: "Email change confirmation token from the link in the confirmation email (valid for 1 hour)" })
  @IsString()
  @IsNotEmpty({ message: "Confirmation token is required." })
  token!: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Endpoint 17: Revoke Session (path param)
// ══════════════════════════════════════════════════════════════════════════════
export class RevokeSessionParamsDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000", description: "UUID of the session to revoke" })
  @IsUUID("4", { message: "Session ID must be a valid UUID." })
  sessionId!: string;
}
