import { initWaaP } from '@human.tech/waap-sdk';
import { LoginMethodConfig } from '../../../lib/types';

export type WaaPConfig = Parameters<typeof initWaaP>[0];

type AuthMethod = "email" | "phone" | "social";

const referralCode = "YCwMtN7ecmLCsAii";

const getAuthenticationMethods = (login: LoginMethodConfig): AuthMethod[] => {
  const methods: AuthMethod[] = [];

  // email method: enable if email OR google is enabled (google is an email-based method in WaaP)
  if (login.email) methods.push("email");

  if (login.phone) methods.push("phone");

  // socials method: enable if ANY social is enabled
  const hasAnySocial = login.google || Object.values(login.socials ?? {}).some(Boolean);
  if (hasAnySocial) methods.push("social");

  return methods;
};

type WaaPSocial = "google" | "twitter" | "discord" | "github" | "bluesky";

const getAllowedSocials = (login: LoginMethodConfig): WaaPSocial[] => {
  const allowed: WaaPSocial[] = [];

  // google is a top-level boolean in your config
  if (login.google) allowed.push("google");

  const socials = login.socials ?? {};
  if (socials.discord) allowed.push("discord");
  if (socials.github) allowed.push("github");
  if (socials.x) allowed.push("twitter"); 
  if (socials.bluesky) allowed.push("bluesky");

  return allowed;
};

export const waapInitConfig = (isDarkMode: boolean, loginConfig: LoginMethodConfig): WaaPConfig => {

  const authenticationMethods = loginConfig
    ? getAuthenticationMethods(loginConfig)
    : ['social', 'email', 'phone'] as AuthMethod[];

  const allowedSocials = loginConfig
    ? getAllowedSocials(loginConfig)
    : ['google', 'twitter', 'discord', 'github', 'bluesky'] as WaaPSocial[];

  return {
    config: {
      authenticationMethods,
      allowedSocials,
      showSecured: true,
      styles: {
        darkMode: isDarkMode,
      },
    },
    useStaging: false,
    asyncSigning: true,
    project: {
      name: "Push Chain",
      logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAL4AAAC+CAYAAACLdLWdAAAACXBIWXMAAAAnAAAAJwEqCZFPAAAHImlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4xLWMwMDMgNzkuOTY5MGE4N2ZjLCAyMDI1LzAzLzA2LTIwOjUwOjE2ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjMuMCAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjMtMDgtMjBUMTk6NDE6NDErMDQ6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDI1LTA3LTI0VDA2OjE5OjA3KzA0OjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDI1LTA3LTI0VDA2OjE5OjA3KzA0OjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo4MTk2MDNhOS1lNmQ0LTQyMGItODQ3Yy05Y2QxYmY0MDY1MTYiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6Nzc5NGEzOGItZTA4Yi00Yjg2LTlhZDctYTdlYTYxM2FkYmE3IiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6Nzc5NGEzOGItZTA4Yi00Yjg2LTlhZDctYTdlYTYxM2FkYmE3Ij4gPHBob3Rvc2hvcDpEb2N1bWVudEFuY2VzdG9ycz4gPHJkZjpCYWc+IDxyZGY6bGk+eG1wLmRpZDo3Nzk0YTM4Yi1lMDhiLTRiODYtOWFkNy1hN2VhNjEzYWRiYTc8L3JkZjpsaT4gPC9yZGY6QmFnPiA8L3Bob3Rvc2hvcDpEb2N1bWVudEFuY2VzdG9ycz4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo3Nzk0YTM4Yi1lMDhiLTRiODYtOWFkNy1hN2VhNjEzYWRiYTciIHN0RXZ0OndoZW49IjIwMjMtMDgtMjBUMTk6NDE6NDErMDQ6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyMy4wIChNYWNpbnRvc2gpIi8+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJzYXZlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDphYTRkMDM0MS01MmU3LTRlNWEtODllZi00NGQxZmJhZWY5MzEiIHN0RXZ0OndoZW49IjIwMjMtMDktMjFUMDU6NTM6NDcrMDQ6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyMy4wIChNYWNpbnRvc2gpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJzYXZlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo4MTk2MDNhOS1lNmQ0LTQyMGItODQ3Yy05Y2QxYmY0MDY1MTYiIHN0RXZ0OndoZW49IjIwMjUtMDctMjRUMDY6MTk6MDcrMDQ6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyNi42IChNYWNpbnRvc2gpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PgRPFYcAAAR8SURBVHja7d0/iGVnGcDh35jdqKgEPRstRDQGiZxKCaJEUggxOiABbS2i6QwiggHBwhAsUorBwkohWGmRSo9rsSH+LWKIFo6KooliCHFvjBhZ3WS4FnvTzQjuzL2zc8/z9LPvfO/9cTlTnG93lstlMDevsgKED8IH4YPwQfggfBA+CB+ED8IH4YPwQfggfBA+CB+ED8IH4SN8ED4IH4QPwgfhg/BB+CB8ED4IH4QPwgfhg/BB+CB8ED4IH4SP8EH4IHwQPggfhA+nzBkrOD57u4vrqxurs6fw139xnIaLc/msdpbLpWKPHvzN1Veqj1evOcVHebr6evXVcRr2hc//iv791fnqhi061vnqrnEaLnvG56DoX1t9d8uir/pI9SV/3HKYT1Rv29KzfW5vd3FG+Bzk1i0+2xurm4TPQd605ed7nfBB+CB8ED4IH4QPwgfhg/BB+CB8ED4I/+RcZwXCn6N3WIHwZ2Vvd/H26jabEP6cot+pHrI/4c8p+ldX36ruso3T68yMgt2p3tLVXf9xdvWzt1ef6fD3bF+ufl89d8y//purd+UeJOH/H8Gfrb5QfbZ665rG/LO6v/rmOA3/WNM5bqjuqR6o3iDdo9nqe3VWN5t9r7pjjWMuVreP0/DbDZ3p3dWPq3MbGPfecRp+6Rn/9PnymqOvuntT0VetZt3tO1v4h30znqnuXfOYJ8dp+P6mz7aa+aR8hX+Qm7pyN8w6XTjB812Qr/APsok7YZ49wfM9K1/hn5SXZzpb+CB8ED4IH4QPwgfhg/BB+CB8EP6JOrfls/eFz0Hes8Wzl9Vfhc9B7tzbXbxz00NXM+9c85hHx2l4Xvgc5Gz18OoVx01Ff3318Gr2ulzqynvKnvE51Aerx/Z2F7dsIPpbqsdWM9flmeqj2/qu7StcV3E8PlD9em938Wj1ePW31TPycdipbqzeV32ow+/rXFQ/q6728WRRPVE9Mk7DpW3/wIR/fK7ryovtd2x47gvV56tvj9Ow72MQ/hw8X902TsPvrMIz/pzcK3rhz80z1XesQfhz8/NxGpbWIPy5edEKhA/CB+GD8EH4CB+ED8IH4YPwQfggfBA+63LJCoQ/R7+xAuHPzb+rR6xB+HPzxXEa/mINwp+LRXXPOA0PWcXRuGXh+OxXP6x+0dXfbXOYl6qnqgtzuPNG+KfHT6pPj9PwB6sQ/lz8qPrwOA2XrcIz/ly8VH1K9MKfm/PjNPzJGoQ/N7+yAuHP0UUrED4IH4QPwgfhg/BB+CB8ED4IH4QPwod5hv+vDcz4j4SEf635Y/X3Nc94QkLCv6aM07BffW2NI35aPS4h4V+LHqx+sIZ/98/VJ/0Hy8K/Vr/1L1cfq+7ryvUcR/VC9Y3q1nEanpbP6bWzXM7nS2tvd3Guev0R/pB9bvUIhfDBow4IH4QPwgfhg/BB+CB8ED4IH4QPwgfhg/ARPggfhA/CB+GD8EH4IHwQPggfhA/CB+GD8EH4IHwQPggfhA/CR/ggfBA+CB+ED8IH4YPwQfggfBA+CB/W7b+dY9IDSEyutAAAAABJRU5ErkJggg==",
      entryTitle: "Welcome to Push Wallet",
      emailLogoCid: 'bafkreifdpzwtpc234zuo66glbkecvdkqxhh3ujg6hqsm3fdtber6i4gsqq',
    },
    referralCode: referralCode,
  }
};