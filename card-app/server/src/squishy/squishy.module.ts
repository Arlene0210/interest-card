import { Module } from '@nestjs/common';
import { SquishyController } from './squishy.controller';
import { SquishyService } from './squishy.service';

@Module({
  controllers: [SquishyController],
  providers: [SquishyService],
  exports: [SquishyService],
})
export class SquishyModule {}
