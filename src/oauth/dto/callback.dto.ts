import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  code_verifier!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirect_uri!: string;
}
