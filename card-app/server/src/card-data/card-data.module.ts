import { Module } from '@nestjs/common';
import { CardDataController } from './card-data.controller';
import { CardDataService } from './card-data.service';

@Module({
  controllers: [CardDataController],
  providers: [CardDataService],
  exports: [CardDataService],
})
export class CardDataModule {}
