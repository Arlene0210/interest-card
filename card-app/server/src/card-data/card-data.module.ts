import { Module } from '@nestjs/common';
import { CardDataController } from './card-data.controller';
import { CardDataService } from './card-data.service';
import { SquishyModule } from '../squishy/squishy.module';

@Module({
  imports: [SquishyModule],
  controllers: [CardDataController],
  providers: [CardDataService],
  exports: [CardDataService],
})
export class CardDataModule {}
