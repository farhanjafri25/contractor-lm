import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
    ],
    controllers: [EventsController],
    providers: [EventsService],
    exports: [EventsService], // shared with other modules that need to query events
})
export class EventsModule { }
