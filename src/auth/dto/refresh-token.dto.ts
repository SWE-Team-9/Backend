import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsOptional } from "class-validator";

export class RefreshTokenDto {
  @ApiProperty({
    description: "Refresh token",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  })
  @IsOptional()
  @IsString()
  refreshToken!: string;
}
