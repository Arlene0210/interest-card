import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController, HealthController } from './app.controller';
import { AppService } from './app.service';
import { LoggerMiddleware } from './logger.middleware';
import { CardDataModule } from './card-data/card-data.module';
import { SquishyModule } from './squishy/squishy.module';

@Module({
  imports: [CardDataModule, SquishyModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
