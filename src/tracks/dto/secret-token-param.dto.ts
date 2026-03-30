import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class SecretTokenParamDto {
  // TODO(Module 4): Add stricter token format validation when secret-link generator contract is finalized.
  @ApiProperty({
    example: "X7f9zK2qP4mN1vB",
    description: "Unguessable secret token used for private track link access.",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  secretToken!: string;
}
