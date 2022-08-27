import { errorMessage } from '@hydrooj/utils/lib/utils';
import { SystemError, UserFacingError } from 'hydrooj/src/error';
import { PERM } from 'hydrooj/src/model/builtin';
import { User } from 'hydrooj/src/model/user';
import type { KoaContext } from '../server';

const serializer = (showDisplayName = false) => (k: string, v: any) => {
    if (k.startsWith('_') && k !== '_id') return undefined;
    if (typeof v === 'bigint') return `BigInt::${v.toString()}`;
    if (v instanceof User && !showDisplayName) delete v.displayName;
    return v;
};

export default (logger) => async (ctx: KoaContext, next) => {
    const { request, response } = ctx.HydroContext;
    try {
        await next();
        const { UiContext, user, args } = ctx.HydroContext;
        if (response.redirect) {
            response.body ||= {};
            response.body.url = response.redirect;
        }
        if (!response.type) {
            if (
                request.json || response.redirect
                || request.query.noTemplate || !response.template) {
                // Send raw data
                try {
                    if (typeof response.body === 'object') {
                        response.body.UiContext = UiContext;
                        response.body.UserContext = user;
                    }
                    response.body = JSON.stringify(response.body, serializer(user?.hasPerm(PERM.PREM_VIEW_DISPLAYNAME)));
                } catch (e) {
                    response.body = new SystemError('Serialize failure', e.message);
                }
                response.type = 'application/json';
            } else if (response.template) {
                const s = response.template.split('.');
                let templateName = `${s[0]}.${args.domainId}.${s[1]}`;
                if (!global.Hydro.ui.template[templateName]) templateName = response.template;
                await ctx.render(templateName, response.body || {});
            }
        }
        if (response.disposition) ctx.set('Content-Disposition', response.disposition);
        if (response.etag) {
            ctx.set('ETag', response.etag);
            ctx.set('Cache-Control', 'public');
        }
    } catch (err) {
        const error = errorMessage(err);
        response.status = error instanceof UserFacingError ? error.code : 500;
        if (request.json) response.body = { error };
        else {
            try {
                await ctx.render(error instanceof UserFacingError ? 'error.html' : 'bsod.html', { UserFacingError, error });
            } catch (e) {
                logger.error(e);
                // this.response.body.error = {};
            }
        }
    } finally {
        if (response.etag && request.headers['if-none-match'] === response.etag) {
            ctx.response.status = 304;
        } else if (response.redirect && !request.json) {
            ctx.response.type = 'application/octet-stream';
            ctx.response.status = 302;
            ctx.redirect(response.redirect);
        } else if (response.body) {
            ctx.body = response.body;
            ctx.response.status = response.status || 200;
            ctx.response.type = response.type
                || (request.json
                    ? 'application/json'
                    : ctx.response.type);
        }
    }
};
