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

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  NON_BINARY = "NON_BINARY",
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
  @IsEmail()
  @Length(1, 255)
  email!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      "password must include uppercase, lowercase, number, and special character.",
  })
  password!: string;

  @Validate(MatchesFieldConstraint, ["password"])
  password_confirm!: string;

  @IsString()
  @Length(2, 50)
  display_name!: string;

  @IsDateString()
  @Validate(IsAdult13Constraint)
  date_of_birth!: string;

  @IsEnum(Gender)
  gender!: Gender;

  /**
   * Google reCAPTCHA v3 token obtained from the frontend.
   * Required in production to prevent automated registration abuse.
   * Optional in development — if RECAPTCHA_SECRET is not configured,
   * the RecaptchaService will skip verification gracefully.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  captchaToken?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember_me?: boolean;
}

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      "new_password must include uppercase, lowercase, number, and special character.",
  })
  new_password!: string;

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
