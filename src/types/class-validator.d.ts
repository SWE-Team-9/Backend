// Ambient module declaration for class-validator.
// The installed package is missing its bundled .d.ts files (corrupted
// node_modules).  This shim provides the minimum type surface needed for the
// project to compile cleanly until node_modules can be reinstalled.
declare module 'class-validator' {
  // ── Interfaces ────────────────────────────────────────────────────────────
  export interface ValidationArguments {
    value: unknown;
    constraints: any[];
    targetName: string;
    object: object;
    property: string;
  }

  export interface ValidatorConstraintInterface {
    validate(value: unknown, validationArguments?: ValidationArguments): boolean | Promise<boolean>;
    defaultMessage?(validationArguments?: ValidationArguments): string;
  }

  // ── Decorators ────────────────────────────────────────────────────────────
  export function IsBoolean(options?: object): PropertyDecorator;
  export function IsEmail(options?: object, validationOptions?: object): PropertyDecorator;
  export function IsEnum(entity: object, options?: object): PropertyDecorator;
  export function IsNotEmpty(options?: object): PropertyDecorator;
  export function IsOptional(options?: object): PropertyDecorator;
  export function IsString(options?: object): PropertyDecorator;
  export function IsUUID(version?: string | number, options?: object): PropertyDecorator;
  export function Length(min: number, max?: number, options?: object): PropertyDecorator;
  export function Matches(pattern: RegExp, options?: object): PropertyDecorator;
  export function MinLength(min: number, options?: object): PropertyDecorator;
  export function MaxLength(max: number, options?: object): PropertyDecorator;
  export function IsArray(options?: object): PropertyDecorator;
  export function ArrayMaxSize(max: number, options?: object): PropertyDecorator;
  export function IsUrl(options?: object, validationOptions?: object): PropertyDecorator;
  export function IsInt(options?: object): PropertyDecorator;
  export function Min(min: number, options?: object): PropertyDecorator;
  export function IsDateString(options?: object, validationOptions?: object): PropertyDecorator;
  export function IsIn(array: readonly unknown[], options?: object): PropertyDecorator;
  export function IsNumber(options?: object, validationOptions?: object): PropertyDecorator;
  export function Validate(constraintClass: new (...args: unknown[]) => ValidatorConstraintInterface, options?: object): PropertyDecorator;
  export function ValidatorConstraint(options?: { name?: string; async?: boolean }): ClassDecorator;
  export function ValidateNested(options?: object): PropertyDecorator;
  export function registerDecorator(options: object): void;
}
