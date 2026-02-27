import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Usage: @CurrentUser() user: RequestUser
export interface RequestUser {
    userId: string;
    tenantId: string;
    role: string;
    email: string;
}

export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): RequestUser => {
        const request = ctx.switchToHttp().getRequest();
        return request.user;
    },
);
