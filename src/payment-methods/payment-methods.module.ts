import { Module } from "@nestjs/common";
import { PaymentMethodsService } from "./payment-methods.service";
import { PaymentMethodsController } from "./payment-methods.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [PaymentMethodsService],
  controllers: [PaymentMethodsController],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
