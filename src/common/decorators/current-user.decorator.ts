import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../types';

export type { RequestUser };

export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        return request.user as RequestUser;
    },
);
