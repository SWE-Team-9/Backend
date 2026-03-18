import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  PREFER_NOT_TO_SAY = "PREFER_NOT_TO_SAY",
}

@ValidatorConstraint({ name: "isAdult13", async: false })
class IsAdult13Constraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const now = new Date();
    const age = now.getFullYear() - date.getFullYear();
    const hasHadBirthdayThisYear =
      now.getMonth() > date.getMonth() ||
      (now.getMonth() === date.getMonth() && now.getDate() >= date.getDate());

    return hasHadBirthdayThisYear ? age >= 13 : age - 1 >= 13;
  }

  defaultMessage(): string {
    return "User must be at least 13 years old.";
  }
}

@ValidatorConstraint({ name: "matchesField", async: false })
class MatchesFieldConstraint implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments): boolean {
    const [field] = args.constraints;
    const relatedValue = (args.object as Record<string, string>)[field];
    return value === relatedValue;
  }

  defaultMessage(args: ValidationArguments): string {
    const [field] = args.constraints;
    return `${args.property} must match ${field}.`;
  }
}

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @Length(1, 255)
  email!: string;

  @ApiProperty({ example: "StrongP@ssw0rd!" })
  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      "password must include uppercase, lowercase, number, and special character.",
  })
  password!: string;

  @ApiProperty({ example: "StrongP@ssw0rd!" })
  @Validate(MatchesFieldConstraint, ["password"])
  password_confirm!: string;

  @ApiProperty({ example: "John Doe" })
  @IsString()
  @Length(2, 50)
  display_name!: string;

  @ApiProperty({ example: "2000-01-01" })
  @IsDateString()
  @Validate(IsAdult13Constraint)
  date_of_birth!: string;

  @ApiProperty({ enum: Gender, example: Gender.MALE })
  @IsEnum(Gender)
  gender!: Gender;

  /**
   * Google reCAPTCHA v3 token obtained from the frontend.
   * Required in production to prevent automated registration abuse.
   * Optional in development — if RECAPTCHA_SECRET is not configured,
   * the RecaptchaService will skip verification gracefully.
   */
  @ApiPropertyOptional({
    example: "03AFcWeA6y4...",
    description: "Google reCAPTCHA token.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  captchaToken?: string;
}

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "StrongP@ssw0rd!" })
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  remember_me?: boolean;
}

export class VerifyEmailQueryDto {
  @ApiProperty({ example: "verification-token-from-email" })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: "password-reset-token-from-email" })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: "NewStrongP@ssw0rd!" })
  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      "new_password must include uppercase, lowercase, number, and special character.",
  })
  new_password!: string;

  @ApiProperty({ example: "NewStrongP@ssw0rd!" })
  @Validate(MatchesFieldConstraint, ["new_password"])
  new_password_confirm!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  current_password!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      "new_password must include uppercase, lowercase, number, and special character.",
  })
  new_password!: string;

  @Validate(MatchesFieldConstraint, ["new_password"])
  new_password_confirm!: string;
}

export class RequestEmailChangeDto {
  @IsEmail()
  new_email!: string;

  @IsString()
  @MinLength(1)
  current_password!: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class RevokeSessionParamsDto {
  @IsUUID()
  sessionId!: string;
}
