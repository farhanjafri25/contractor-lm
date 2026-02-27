import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('access')
@UseGuards(JwtAuthGuard)
export class UaccessController {
  // TODO: implement access endpoints
}
