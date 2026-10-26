import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { PROVIDER_LOGO } from '../sessions/provider-logos';
import { FloorDesk, FloorRoom, PageBlock } from './plugin-page-view';

type FloorBlock = Extract<PageBlock, { type: 'floorplan' }>;

/** World measurements, in "floor" px: the 3D drawing projects them with rotateX/rotateZ. */
const DESK_W = 104, DESK_D = 66, DESK_H = 16, GAP = 30, PAD = 30, HEAD = 64, WALL_H = 22, HUB_R = 62, MAX_SPRITES = 8;
const DEFAULT_ROT = 40, DEFAULT_TILT = 54;

interface PlacedDesk { desk: FloorDesk; x: number; y: number }
interface PlacedRoom { room: FloorRoom; x: number; y: number; w: number; h: number; desks: PlacedDesk[]; busy: boolean; waiting: number; alert: 'input' | 'done' | null }
interface Layout { w: number; h: number; hubX: number; hubY: number; rooms: PlacedRoom[] }
interface Hover { desk: FloorDesk; room: string; x: number; y: number }

/**
 * Floor plan: virtual 3D isometric office (rooms = nodes of a graph around a hub, desks = blocks,
 * agents = standing avatars) explored like a map, or a 2D plan. Draws ONLY already normalized data:
 * no HTML or styles from outside, and a desk opens a session only if it is one of the user's.
 */
@Component({
  selector: 'app-plugin-floorplan',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    @if (!block().rooms.length) {
      @if (block().empty) { <p class="fp-empty">{{ block().empty }}</p> }
    } @else {
      @let L = layout();
      @if (!compact()) {
      <div class="fp-bar">
        @if (mode() === '3d') {
          <!-- Tabs styled like the Terminal | Code Editor switch: the first goes back to the overview -->
          <div class="fp-tabs" role="tablist" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Rooms' | translate">
            <button type="button" role="tab" class="fp-tab" [class.active]="focused() === null" [attr.aria-selected]="focused() === null" (click)="overview()" [title]="'SESSIONS.FLOOR_PLAN.Canvas.Overview hint' | translate">
              <i class="ti ti-zoom-out-area" aria-hidden="true"></i><span>{{ 'SESSIONS.FLOOR_PLAN.Canvas.Overview' | translate }}</span>
            </button>
            @for (r of L.rooms; track $index; let i = $index) {
              <button type="button" role="tab" class="fp-tab" [class.active]="focused() === i" [attr.aria-selected]="focused() === i" [style.--c]="r.room.color || null"
                      (click)="following.set(false); focusRoom(i)">
                <span class="dot" aria-hidden="true"></span><span>{{ r.room.title }}</span>
                @if (r.alert) { <span class="fp-tab-alert" [ngClass]="'al-' + r.alert" [attr.aria-label]="(r.alert === 'input' ? 'SESSIONS.FLOOR_PLAN.Canvas.Needs input' : 'SESSIONS.FLOOR_PLAN.Canvas.Finished') | translate"></span> }
              </button>
            }
          </div>
        }
        <div class="fp-right">
          @if (mode() === '3d') {
            <button type="button" class="fp-tab fp-follow" [class.active]="following()" (click)="toggleFollow()" [attr.aria-pressed]="following()"
                    [title]="'SESSIONS.FLOOR_PLAN.Canvas.Follow hint' | translate">
              <i class="ti" [ngClass]="following() ? 'ti-eye-check' : 'ti-eye'" aria-hidden="true"></i><span>{{ 'SESSIONS.FLOOR_PLAN.Canvas.Follow' | translate }}</span>
            </button>
            <div class="fp-tools">
              <button type="button" class="fp-icon" (click)="following.set(false); rotateBy(-20)" [title]="'SESSIONS.FLOOR_PLAN.Canvas.Turn left' | translate: { key: 'Q' }" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Turn left' | translate: { key: 'Q' }"><i class="ti ti-rotate" aria-hidden="true"></i></button>
              <button type="button" class="fp-icon" (click)="following.set(false); rotateBy(20)" [title]="'SESSIONS.FLOOR_PLAN.Canvas.Turn right' | translate: { key: 'E' }" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Turn right' | translate: { key: 'E' }"><i class="ti ti-rotate-clockwise" aria-hidden="true"></i></button>
              <button type="button" class="fp-icon" (click)="following.set(false); zoomAt(1.25)" [title]="'SESSIONS.FLOOR_PLAN.Canvas.Zoom in' | translate: { key: '+' }" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Zoom in' | translate: { key: '+' }"><i class="ti ti-zoom-in" aria-hidden="true"></i></button>
              <button type="button" class="fp-icon" (click)="following.set(false); zoomAt(0.8)" [title]="'SESSIONS.FLOOR_PLAN.Canvas.Zoom out' | translate: { key: '−' }" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Zoom out' | translate: { key: '−' }"><i class="ti ti-zoom-out" aria-hidden="true"></i></button>
            </div>
          }
          <div class="fp-tabs" role="group" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.View' | translate">
            <button type="button" class="fp-tab" [class.active]="mode() === '3d'" (click)="setMode('3d')"><i class="ti ti-cube-3d-sphere" aria-hidden="true"></i><span>3D</span></button>
            <button type="button" class="fp-tab" [class.active]="mode() === '2d'" (click)="setMode('2d')"><i class="ti ti-layout-grid" aria-hidden="true"></i><span>2D</span></button>
          </div>
        </div>
      </div>
      }

      @if (mode() === '3d') {
        <div #stage class="fp-stage" [class.fill]="fill()" [class.dragging]="dragging()" tabindex="0"
             [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Stage' | translate"
             (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onUp($event)"
             (wheel)="onWheel($event)" (contextmenu)="$event.preventDefault()" (keydown)="onKey($event)" (dblclick)="onDbl($event)">
          <div class="fp-world" [class.near]="scale() >= 1.25" [style.width.px]="L.w" [style.height.px]="L.h"
               [style.transform]="worldTransform()" [style.--r]="rot() + 'deg'" [style.--t]="tilt() + 'deg'" [style.--k]="labelScale()">
            <svg class="fp-edges" [attr.width]="L.w" [attr.height]="L.h" [attr.viewBox]="'0 0 ' + L.w + ' ' + L.h" aria-hidden="true">
              @for (r of L.rooms; track $index) {
                <line [attr.x1]="L.hubX" [attr.y1]="L.hubY" [attr.x2]="r.x + r.w / 2" [attr.y2]="r.y + r.h / 2" [class.busy]="r.busy"
                      [style.stroke]="r.room.color || null" />
              }
            </svg>

            <div class="fp-hub" [style.left.px]="L.hubX" [style.top.px]="L.hubY">
              <div class="fp-hub-disc"></div>
              <div class="fp-bill fp-hub-label" style="--z: 30px">{{ block().hub || 'PromptOps' }}</div>
            </div>

            @for (r of L.rooms; track $index; let ri = $index) {
              <section class="fp-room" [class.focused]="focused() === ri" [style.left.px]="r.x" [style.top.px]="r.y" [style.width.px]="r.w" [style.height.px]="r.h"
                       [style.--c]="r.room.color || null" [attr.aria-label]="r.room.title" (click)="onRoomClick(ri, $event)">
                <div class="fp-wall n"></div>
                <div class="fp-wall w"></div>
                <div class="fp-floor-name">{{ r.room.title }}</div>
                <div class="fp-sign-anchor" [style.left.px]="r.w / 2">
                  <div class="fp-bill fp-sign" [style.--z]="WALL_H + 64 + 'px'">
                    <strong>{{ r.room.title }}</strong>@if (r.room.subtitle) { <small>{{ r.room.subtitle }}</small> }
                  </div>
                </div>
                @for (d of r.desks; track $index) {
                  <button type="button" class="fp-desk" [ngClass]="['st-' + d.desk.status, d.desk.alert ? 'al-' + d.desk.alert.kind : '']" [class.locked]="!canOpen(d.desk)" [class.current]="isCurrent(d.desk)" [class.spot]="spot() === ri + '/' + $index"
                          [style.left.px]="d.x" [style.top.px]="d.y" (click)="open(d.desk, $event)"
                          (pointerenter)="hoverDesk(d.desk, r.room.title, $event)" (pointermove)="hoverDesk(d.desk, r.room.title, $event)" (pointerleave)="hovered.set(null)"
                          [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Canvas.Open desk' | translate: { name: d.desk.title + (d.desk.subtitle ? ', ' + d.desk.subtitle : ''), status: statusLabel(d.desk.status) }"
                          [attr.aria-disabled]="!canOpen(d.desk)">
                    <span class="fp-top"><span class="fp-led"></span></span>
                    <span class="fp-front"></span>
                    <span class="fp-side"></span>
                    <span class="fp-shadow"></span>
                    @for (a of sprites(d.desk); track $index; let i = $index) {
                      <span class="fp-agent-anchor" [style.left.px]="spriteX(d.desk, i)" [style.top.px]="spriteY(d.desk, i)">
                        <span class="fp-bill fp-agent" [ngClass]="'st-' + a.status" [style.--z]="DESK_H + 'px'">
                          @if (a.status === 'waiting') { <span class="fp-bubble">!</span> }
                          <span class="fp-head">@if (a.provider) { <img [src]="logo(a.provider)" alt="" /> }</span>
                          <span class="fp-body"></span>
                        </span>
                      </span>
                    }
                    @if (d.desk.alert; as al) {
                      <!-- Silent alert: rises from the desk and fades; the desk stays lit -->
                      @for (k of [al.seq]; track k) {
                        <span class="fp-tag-anchor">
                          <span class="fp-bill fp-pop" [style.--z]="DESK_H + 92 + 'px'">
                            <span class="fp-pop-in" [ngClass]="'al-' + al.kind"><i class="ti" [ngClass]="al.kind === 'input' ? 'ti-message-question' : 'ti-circle-check'" aria-hidden="true"></i>{{ al.text }}</span>
                          </span>
                        </span>
                      }
                    }
                    <span class="fp-tag-anchor">
                      <span class="fp-bill fp-tag" [style.--z]="DESK_H + 46 + 'px'">
                        {{ d.desk.title }}@if (d.desk.badge) { <b>{{ d.desk.badge }}</b> }
                        @if (d.desk.agents.length > MAX_SPRITES) { <em>+{{ d.desk.agents.length - MAX_SPRITES }}</em> }
                      </span>
                    </span>
                  </button>
                }
              </section>
            }
          </div>

          @if (hovered(); as h) {
            <div class="fp-card" [style.left.px]="h.x" [style.top.px]="h.y" role="tooltip">
              <div class="fp-card-head"><span class="led" [ngClass]="'st-' + h.desk.status"></span><strong>{{ h.desk.title }}</strong>
                @if (h.desk.badge) { <b>{{ 'SESSIONS.FLOOR_PLAN.Canvas.Badge waiting' | translate: { count: h.desk.badge } }}</b> }</div>
              <small>{{ h.room }}@if (h.desk.subtitle) { · {{ h.desk.subtitle }} }</small>
              @if (h.desk.alert; as al) { <div class="fp-card-alert" [ngClass]="'al-' + al.kind">{{ al.text }} · {{ ago(al.at) }}</div> }
              <ul>
                @for (a of h.desk.agents; track $index) {
                  <li [ngClass]="'st-' + a.status"><span class="led"></span>@if (a.provider) { <img [src]="logo(a.provider)" alt="" /> }<span class="n">{{ a.name }}</span><span class="s">{{ statusLabel(a.status) }}</span></li>
                }
              </ul>
              <em>{{ (canOpen(h.desk) ? 'SESSIONS.FLOOR_PLAN.Canvas.Click to open' : 'SESSIONS.FLOOR_PLAN.Canvas.Not available') | translate }}</em>
            </div>
          }

          <div class="fp-legend" aria-hidden="true">
            <span class="st-working">{{ statusLabel('working') }}</span><span class="st-waiting">{{ statusLabel('waiting') }}</span><span class="st-idle">{{ statusLabel('idle') }}</span>
            <span class="st-standby">{{ statusLabel('standby') }}</span><span class="st-error">{{ statusLabel('error') }}</span>
          </div>
          @if (!compact()) {
            <div class="fp-help" aria-hidden="true">{{ 'SESSIONS.FLOOR_PLAN.Canvas.Help' | translate }}</div>
          }
        </div>
      } @else {
        <div class="fp-grid" [class.compact]="compact()" [class.fill]="fill()" role="list">
          @for (room of block().rooms; track $index) {
            <section class="fp-groom" [class.wide]="room.wide" role="listitem" [style.--c]="room.color || null">
              <header class="fp-groom-head">
                <span class="fp-groom-dot" aria-hidden="true"></span>
                <strong>{{ room.title }}</strong>
                @if (room.subtitle) { <small>{{ room.subtitle }}</small> }
                @if (roomAlert(room); as ra) { <span class="fp-tab-alert" [ngClass]="'al-' + ra"></span> }
              </header>
              <div class="fp-groom-floor">
                @for (d of room.desks; track $index) {
                  <button type="button" class="fp-gdesk" [ngClass]="['st-' + d.status, d.alert ? 'al-' + d.alert.kind : '']" [class.current]="isCurrent(d)" [disabled]="!canOpen(d)" (click)="open(d, $event)"
                          [attr.title]="d.subtitle ? d.title + ' · ' + d.subtitle : d.title">
                    <span class="fp-gdesk-top">
                      <span class="fp-gled" aria-hidden="true"></span>
                      <span class="fp-gdesk-title">{{ d.title }}</span>
                      @if (d.badge) { <span class="fp-gbadge">{{ d.badge }}</span> }
                    </span>
                    @if (d.alert; as al) { <small class="fp-galert" [ngClass]="'al-' + al.kind"><i class="ti" [ngClass]="al.kind === 'input' ? 'ti-message-question' : 'ti-circle-check'" aria-hidden="true"></i>{{ al.text }}</small> }
                    @else if (d.subtitle) { <small class="fp-gsub">{{ d.subtitle }}</small> }
                    @if (d.agents.length) {
                      <span class="fp-gagents">
                        @for (a of d.agents; track $index) {
                          <span class="fp-gagent" [ngClass]="'st-' + a.status" [attr.title]="a.name + ' · ' + statusLabel(a.status)">
                            @if (a.provider) { <img [src]="logo(a.provider)" alt="" /> }
                            <span>{{ a.name }}</span>
                          </span>
                        }
                      </span>
                    }
                  </button>
                }
              </div>
            </section>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; }
    .st-working { --st: #22c55e; } .st-waiting { --st: #f59e0b; } .st-idle { --st: #6366f1; }
    .st-standby { --st: #94a3b8; } .st-error { --st: #ef4444; } .st-off { --st: #64748b; }
    .fp-empty { opacity: .7; font-size: 13px; }
    .fp-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; min-width: 0; }
    .fp-right { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
    /* Same design as the session header's Terminal | Code Editor switch */
    .fp-tabs { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; height: 28px; min-width: 0; overflow-x: auto; scrollbar-width: none;
      background: rgba(127,127,127,.05); border: 1px solid var(--po-border-subtle, var(--promptops-border-color, rgba(127,127,127,.25))); user-select: none; }
    .fp-tabs::-webkit-scrollbar { display: none; }
    .fp-tab { --c: var(--promptops-primary, #6366f1); position: relative; display: flex; align-items: center; gap: 5px; height: 100%; padding: 0 .55rem; border: 0; border-radius: 4px;
      background: transparent; font: inherit; font-size: .72rem; font-weight: 500; white-space: nowrap; cursor: pointer; flex: none;
      color: var(--po-text-secondary, inherit); transition: color .15s, background .15s; }
    .fp-tab:hover:not(.active) { color: var(--po-text-primary, inherit); background: rgba(127,127,127,.08); }
    .fp-tab.active { background: rgba(139, 92, 246, .18); color: var(--po-accent, #8b5cf6); font-weight: 600; }
    .fp-tab .ti { font-size: 14px; }
    .fp-tab .dot { width: 7px; height: 7px; border-radius: 2px; background: var(--c); }
    .fp-follow { height: 28px; border: 1px solid var(--po-border-subtle, var(--promptops-border-color, rgba(127,127,127,.25))); border-radius: 6px; }
    .fp-follow.active { border-color: rgba(139, 92, 246, .45); }
    .fp-tab-alert { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .al-input.fp-tab-alert { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
    .al-done.fp-tab-alert { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
    .fp-tools { display: flex; gap: 3px; }
    .fp-icon { border: 1px solid var(--promptops-border-color, rgba(127,127,127,.3)); background: transparent; color: inherit; border-radius: 6px; width: 28px; height: 28px; display: inline-grid; place-items: center; cursor: pointer; }
    .fp-icon:hover { background: rgba(99,102,241,.08); }
    @media (max-width: 900px) { .fp-tools { display: none; } }

    /* ── 3D ── */
    .fp-stage { position: relative; height: clamp(420px, 68vh, 760px); overflow: hidden; border-radius: 12px; cursor: grab; touch-action: none; user-select: none;
      perspective: 2600px; perspective-origin: 50% 50%; outline: none;
      background: radial-gradient(ellipse at 50% 40%, oklch(from var(--po-accent) l c h / 10%), transparent 65%), var(--promptops-card-bg, rgba(127,127,127,.04));
      border: 1px solid var(--promptops-border-color, rgba(127,127,127,.25)); }
    .fp-stage.fill { height: auto; flex: 1; min-height: 260px; }
    .fp-stage:focus-visible { box-shadow: 0 0 0 2px var(--promptops-primary, #6366f1); }
    .fp-stage.dragging { cursor: grabbing; }
    .fp-world { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; transform-style: preserve-3d; transition: transform .38s cubic-bezier(.2,.8,.2,1);
      background-image: linear-gradient(rgba(127,127,127,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,.10) 1px, transparent 1px);
      background-size: 40px 40px; border-radius: 24px; }
    .fp-stage.dragging .fp-world { transition: none; }
    .fp-edges { position: absolute; inset: 0; overflow: visible; }
    .fp-edges line { stroke: var(--promptops-primary, #6366f1); stroke-width: 3; stroke-opacity: .35; stroke-dasharray: 2 10; stroke-linecap: round; }
    .fp-edges line.busy { stroke-opacity: .85; stroke-dasharray: 10 10; animation: fp-flow 1.2s linear infinite; }
    @keyframes fp-flow { to { stroke-dashoffset: -40; } }

    /* "Standing" towards the camera: cancels the world rotation and keeps the same size at every zoom (--k). */
    .fp-bill { position: absolute; left: 0; top: 0; transform-origin: 0 0; white-space: nowrap; pointer-events: none;
      transform: translateZ(var(--z, 0px)) rotateZ(calc(-1 * var(--r))) rotateX(calc(-1 * var(--t))) scale(var(--k, 1)) translate(-50%, -100%); }
    .fp-agent.fp-bill { transform: translateZ(var(--z, 0px)) rotateZ(calc(-1 * var(--r))) rotateX(calc(-1 * var(--t))) translate(-50%, -100%); }

    .fp-hub { position: absolute; transform-style: preserve-3d; }
    .fp-hub-disc { position: absolute; width: ${HUB_R * 2}px; height: ${HUB_R * 2}px; left: -${HUB_R}px; top: -${HUB_R}px; border-radius: 50%;
      background: radial-gradient(circle, #8b5cf6, #6366f1 60%, #4338ca); box-shadow: 0 0 0 10px rgba(99,102,241,.18), 0 0 60px rgba(99,102,241,.55);
      transform: translateZ(4px); }
    .fp-hub-label { font-size: 15px; font-weight: 800; letter-spacing: .02em; color: #fff; padding: 6px 12px; border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 6px 20px rgba(79,70,229,.45); }

    .fp-room { --c: var(--promptops-primary, #6366f1); position: absolute; transform-style: preserve-3d; border-radius: 6px; cursor: zoom-in;
      background: color-mix(in srgb, var(--c) 9%, var(--promptops-body-bg, #fff)); border: 2px solid color-mix(in srgb, var(--c) 55%, transparent);
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--c) 8%, transparent); transition: box-shadow .2s; }
    .fp-room.focused { box-shadow: 0 0 0 6px color-mix(in srgb, var(--c) 30%, transparent); cursor: default; }
    .fp-stage.dragging .fp-room { cursor: grabbing; }
    .fp-wall { position: absolute; background: linear-gradient(to top, color-mix(in srgb, var(--c) 40%, transparent), color-mix(in srgb, var(--c) 14%, transparent));
      border: 1px solid color-mix(in srgb, var(--c) 50%, transparent); }
    .fp-wall.n { left: 0; right: 0; top: -${WALL_H}px; height: ${WALL_H}px; transform-origin: bottom; transform: rotateX(-90deg); }
    .fp-wall.w { top: 0; bottom: 0; left: -${WALL_H}px; width: ${WALL_H}px; transform-origin: right; transform: rotateY(90deg); }
    .fp-floor-name { position: absolute; left: 12px; bottom: 6px; font-size: 22px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
      color: color-mix(in srgb, var(--c) 30%, transparent); pointer-events: none; white-space: nowrap; overflow: hidden; max-width: calc(100% - 24px); }
    .fp-sign-anchor, .fp-agent-anchor, .fp-tag-anchor { position: absolute; transform-style: preserve-3d; width: 0; height: 0; }
    .fp-sign-anchor { top: 0; }
    .fp-sign { display: flex; flex-direction: column; align-items: center; padding: 5px 12px; border-radius: 9px; font-size: 14px; line-height: 1.25;
      background: rgba(15,23,42,.9); border: 2px solid var(--c); box-shadow: 0 6px 18px rgba(0,0,0,.25); color: #f8fafc; }
    .fp-sign small { font-size: 11px; color: #cbd5e1; font-weight: 500; }

    .fp-desk { --st: #94a3b8; position: absolute; width: ${DESK_W}px; height: ${DESK_D}px; padding: 0; border: 0; background: none; color: inherit; font: inherit;
      transform-style: preserve-3d; cursor: pointer; }
    .fp-desk.locked { cursor: not-allowed; }
    .fp-desk:focus-visible .fp-top { outline: 3px solid var(--promptops-primary, #6366f1); outline-offset: 2px; }
    .fp-top, .fp-front, .fp-side, .fp-shadow { position: absolute; display: block; }
    .fp-top { inset: 0; transform: translateZ(${DESK_H}px); border-radius: 4px; border: 1px solid rgba(0,0,0,.08);
      background: linear-gradient(135deg, color-mix(in srgb, var(--st) 22%, #f8fafc), color-mix(in srgb, var(--st) 10%, #e2e8f0)); transition: filter .15s; }
    .fp-desk.current .fp-top { outline: 3px solid var(--promptops-primary, #6366f1); outline-offset: 3px; }
    .fp-led { position: absolute; right: 8px; top: 8px; width: 10px; height: 10px; border-radius: 50%; background: var(--st); box-shadow: 0 0 10px var(--st); }
    .fp-front { left: 0; top: ${DESK_D}px; width: ${DESK_W}px; height: ${DESK_H}px; transform-origin: top; transform: rotateX(90deg);
      background: color-mix(in srgb, var(--st) 35%, #475569); }
    .fp-side { left: ${DESK_W}px; top: 0; width: ${DESK_H}px; height: ${DESK_D}px; transform-origin: left; transform: rotateY(-90deg);
      background: color-mix(in srgb, var(--st) 25%, #334155); }
    .fp-shadow { inset: 6px -6px -10px 8px; background: rgba(0,0,0,.18); filter: blur(6px); border-radius: 6px; }
    .fp-desk:not(.locked):hover .fp-top { filter: brightness(1.12) saturate(1.25); }
    .fp-desk.st-standby :is(.fp-top, .fp-front, .fp-side, .fp-agent), .fp-desk.st-off :is(.fp-top, .fp-front, .fp-side, .fp-agent) { opacity: .5; }
    .fp-desk.st-standby .fp-tag, .fp-desk.st-off .fp-tag { background: rgba(71,85,105,.85); }
    /* Alerts: the desk stays lit until the session is opened */
    .fp-desk.al-input .fp-top { box-shadow: 0 0 0 3px rgba(245,158,11,.95), 0 0 30px 8px rgba(245,158,11,.5); animation: fp-glow 2.6s ease-in-out infinite; }
    .fp-desk.al-done .fp-top { box-shadow: 0 0 0 3px rgba(34,197,94,.9), 0 0 26px 6px rgba(34,197,94,.42); animation: fp-glow 3.2s ease-in-out infinite; }
    .fp-desk.al-input .fp-shadow { background: rgba(245,158,11,.35); }
    .fp-desk.al-done .fp-shadow { background: rgba(34,197,94,.3); }
    .fp-desk.spot::after { content: ''; position: absolute; inset: -18px; border-radius: 14px; border: 2px dashed rgba(139,92,246,.7); pointer-events: none; }
    @keyframes fp-glow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.18); } }
    .fp-pop { z-index: 2; }
    .fp-pop-in { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; white-space: nowrap;
      background: rgba(15,23,42,.92); color: #f8fafc; box-shadow: 0 6px 18px rgba(0,0,0,.3); opacity: 0; animation: fp-rise 5.5s ease-out forwards; }
    .fp-pop-in.al-input { border: 1.5px solid #f59e0b; } .fp-pop-in.al-input .ti { color: #fbbf24; }
    .fp-pop-in.al-done { border: 1.5px solid #22c55e; } .fp-pop-in.al-done .ti { color: #4ade80; }
    @keyframes fp-rise { 0% { opacity: 0; transform: translateY(14px); } 10% { opacity: 1; transform: translateY(0); } 78% { opacity: 1; transform: translateY(-16px); } 100% { opacity: 0; transform: translateY(-26px); } }

    .fp-agent { display: flex; flex-direction: column; align-items: center; }
    .fp-head { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #fff;
      border: 2.5px solid var(--st); box-shadow: 0 2px 6px rgba(0,0,0,.25); }
    .fp-head img { width: 13px; height: 13px; }
    .fp-body { width: 16px; height: 9px; margin-top: -1px; border-radius: 8px 8px 2px 2px; background: var(--st); }
    .fp-agent.st-working .fp-head { animation: fp-bob 1.1s ease-in-out infinite; }
    .fp-bubble { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); width: 16px; height: 16px; border-radius: 50%;
      background: #f59e0b; color: #1f1300; font-size: 11px; font-weight: 900; display: grid; place-items: center; animation: fp-ping 1.4s ease-in-out infinite; }
    @keyframes fp-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes fp-ping { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.18); } }
    .fp-tag-anchor { left: ${DESK_W / 2}px; top: ${DESK_D / 2}px; }
    .fp-tag { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
      background: rgba(15,23,42,.85); color: #f8fafc; display: inline-flex; gap: 5px; align-items: center; }
    .fp-tag b { background: #f59e0b; color: #1f1300; border-radius: 8px; padding: 0 5px; font-size: 10px; }
    .fp-tag em { font-style: normal; opacity: .7; font-size: 10px; }

    .fp-card { position: absolute; z-index: 5; pointer-events: none; width: 250px; padding: 10px 12px; border-radius: 10px; font-size: 12px;
      background: rgba(15,23,42,.96); color: #f1f5f9; box-shadow: 0 12px 32px rgba(0,0,0,.35); border: 1px solid rgba(148,163,184,.25); }
    .fp-card-head { display: flex; align-items: center; gap: 6px; }
    .fp-card-head strong { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fp-card-head b { font-size: 10px; background: #f59e0b; color: #1f1300; border-radius: 8px; padding: 0 6px; white-space: nowrap; }
    .fp-card small { display: block; color: #94a3b8; margin: 2px 0 6px; }
    .fp-card ul { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .fp-card li { display: flex; align-items: center; gap: 6px; }
    .fp-card li img { width: 12px; height: 12px; }
    .fp-card li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fp-card li .s { color: var(--st); font-size: 11px; }
    .fp-card .led { width: 8px; height: 8px; border-radius: 50%; background: var(--st); flex: none; }
    .fp-card em { font-style: normal; font-size: 11px; color: #a5b4fc; }
    .fp-card-alert { font-size: 11.5px; font-weight: 600; margin: -2px 0 6px; }
    .fp-card-alert.al-input { color: #fbbf24; } .fp-card-alert.al-done { color: #4ade80; }

    .fp-legend { position: absolute; left: 10px; bottom: 8px; display: flex; gap: 10px; font-size: 11px; opacity: .85; flex-wrap: wrap; pointer-events: none; }
    .fp-legend span { display: inline-flex; align-items: center; gap: 4px; }
    .fp-legend span::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--st); }
    .fp-help { position: absolute; right: 10px; bottom: 8px; font-size: 11px; opacity: .6; pointer-events: none; }
    @media (max-width: 760px) { .fp-help { display: none; } }

    /* ── 2D ── */
    .fp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; align-content: start; }
    .fp-grid.fill { flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px; }
    .fp-grid.compact { grid-template-columns: 1fr; gap: 10px; }
    .fp-grid.compact .fp-groom { padding: 8px 9px 10px; }
    .fp-grid.compact .fp-groom-head { flex-wrap: wrap; row-gap: 0; margin-bottom: 8px; }
    .fp-grid.compact .fp-groom-head strong { overflow: visible; white-space: normal; }
    .fp-grid.compact .fp-groom-head small { flex-basis: 100%; padding-left: 16px; order: 3; }
    .fp-grid.compact .fp-groom-head .fp-tab-alert { align-self: center; }
    .fp-groom { --c: var(--promptops-primary, #6366f1); border: 1px solid var(--promptops-border-color, rgba(127,127,127,.25));
      border-top: 3px solid var(--c); border-radius: 10px; padding: 10px 12px 12px; min-width: 0; background-color: var(--promptops-card-bg, transparent);
      background-image: linear-gradient(rgba(127,127,127,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,.07) 1px, transparent 1px);
      background-size: 18px 18px; }
    .fp-groom.wide { grid-column: 1 / -1; }
    .fp-groom-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; min-width: 0; }
    .fp-groom-head strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fp-groom-head small { opacity: .65; font-size: 11px; white-space: nowrap; }
    .fp-groom-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--c); flex: none; align-self: center; }
    .fp-groom-floor { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
    .compact .fp-groom-floor { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .fp-gdesk { --st: #94a3b8; display: flex; flex-direction: column; align-items: stretch; gap: 4px; text-align: left; min-width: 0; padding: 7px 8px; border-radius: 8px;
      border: 1px solid var(--promptops-border-color, rgba(127,127,127,.25)); border-left: 3px solid var(--st);
      background: var(--promptops-body-bg, rgba(255,255,255,.04)); color: inherit; font: inherit; cursor: pointer; transition: transform .12s, box-shadow .12s; }
    .fp-gdesk.current { box-shadow: 0 0 0 2px var(--promptops-primary, #6366f1); }
    .fp-gdesk.al-input { box-shadow: 0 0 0 2px #f59e0b, 0 0 16px rgba(245,158,11,.45); border-left-color: #f59e0b; }
    .fp-gdesk.al-done { box-shadow: 0 0 0 2px #22c55e, 0 0 14px rgba(34,197,94,.4); border-left-color: #22c55e; }
    .fp-galert { display: flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fp-galert.al-input { color: #d97706; } .fp-galert.al-done { color: #16a34a; }
    .fp-gdesk:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0,0,0,.12); }
    .fp-gdesk:disabled { cursor: default; }
    .fp-gdesk.st-standby, .fp-gdesk.st-off { opacity: .55; }
    .fp-gdesk-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .fp-gdesk-title { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .fp-gbadge { font-size: 10px; font-weight: 700; padding: 0 5px; border-radius: 8px; background: #f59e0b; color: #1f1300; flex: none; }
    .fp-gsub { font-size: 10.5px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fp-gled { width: 8px; height: 8px; border-radius: 50%; background: var(--st); flex: none; }
    .fp-gdesk.st-working .fp-gled, .fp-gagent.st-working::before { animation: fp-pulse 1.4s ease-in-out infinite; }
    .fp-gagents { display: flex; flex-wrap: wrap; gap: 4px; }
    .fp-gagent { --st: #94a3b8; display: inline-flex; align-items: center; gap: 3px; max-width: 100%; padding: 1px 6px 1px 4px; border-radius: 10px;
      font-size: 10.5px; background: rgba(127,127,127,.12); min-width: 0; }
    .fp-gagent::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--st); flex: none; }
    .fp-gagent img { width: 11px; height: 11px; flex: none; }
    .fp-gagent span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px; }
    @keyframes fp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

    @media (prefers-reduced-motion: reduce) {
      .fp-world { transition: none; }
      .fp-desk.al-input .fp-top, .fp-desk.al-done .fp-top, .fp-edges line.busy, .fp-agent.st-working .fp-head, .fp-bubble, .fp-gdesk.st-working .fp-gled, .fp-gagent.st-working::before { animation: none; }
    }
  `],
})
export class PluginFloorplanComponent {
  readonly block = input.required<FloorBlock>();
  /** Ids of the user's sessions: only these can be opened. */
  readonly openable = input<Set<string>>(new Set());
  /** Narrow side panel: starts in 2D, no row of rooms. */
  readonly compact = input(false);
  /** The scene takes the full height of the container (sessions view) instead of a fixed height. */
  readonly fill = input(false);
  /** Session open right now: its desk is highlighted. */
  readonly activeSession = input<string | null>(null);
  readonly openDesk = output<FloorDesk>();

  protected readonly DESK_H = DESK_H;
  protected readonly WALL_H = WALL_H;
  protected readonly MAX_SPRITES = MAX_SPRITES;

  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly stageSize = signal({ w: 900, h: 600 });
  private readonly modeOverride = signal<'3d' | '2d' | null>(null);
  /** In the (compact) sidebar only 2D: 3D and its controls do not fit. */
  readonly mode = computed<'3d' | '2d'>(() => (this.compact() ? '2d' : this.modeOverride() ?? this.readMode(false)));
  readonly rot = signal(DEFAULT_ROT);
  readonly tilt = signal(DEFAULT_TILT);
  readonly zoom = signal(1);
  /** World point at the center of the scene. null = center of the world. */
  private readonly center = signal<{ x: number; y: number } | null>(null);
  readonly focused = signal<number | null>(null);
  readonly hovered = signal<Hover | null>(null);
  readonly dragging = signal(false);
  /** Follow mode: the camera goes where something happens (new alert), otherwise it cycles through the busy desks. */
  readonly following = signal(false);
  /** Desk framed by Follow mode ("room/desk"). */
  readonly spot = signal<string | null>(null);
  private followedSeq = 0;
  private followHoldUntil = 0;
  private followCursor = 0;
  private followLastMove = 0;
  private followTimer: ReturnType<typeof setInterval> | null = null;
  private drag: { x: number; y: number; lastX: number; lastY: number; rot: number; tilt: number; moved: boolean; id: number; turn: boolean } | null = null;
  private suppressClick = false;

  constructor() {
    afterNextRender(() => {
      const ro = new ResizeObserver(() => this.measure());
      ro.observe(this.host.nativeElement);
      this.measure();
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
    this.destroyRef.onDestroy(() => this.followTimer && clearInterval(this.followTimer));
  }

  roomAlert(room: FloorRoom): 'input' | 'done' | null {
    const kinds = room.desks.map((d) => d.alert?.kind).filter(Boolean);
    return kinds.includes('input') ? 'input' : kinds.includes('done') ? 'done' : null;
  }

  ago(at: number): string {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    const t = (k: string, n?: number) => this.translate.instant('SESSIONS.FLOOR_PLAN.Canvas.' + k, { n });
    return s < 60 ? t('Just now') : s < 3600 ? t('Minutes ago', Math.round(s / 60)) : t('Hours ago', Math.round(s / 3600));
  }

  overview(): void {
    this.following.set(false);
    this.resetView();
  }

  toggleFollow(): void {
    const on = !this.following();
    this.following.set(on);
    if (this.followTimer) { clearInterval(this.followTimer); this.followTimer = null; }
    this.spot.set(null);
    if (!on) return;
    this.followedSeq = 0;
    this.followHoldUntil = 0;
    this.followLastMove = 0;
    this.followTick();
    this.followTimer = setInterval(() => (this.following() && this.mode() === '3d' ? this.followTick() : undefined), 1200);
  }

  /** The most recent new alert first; with no alerts, in turn the desks where someone is working or waiting. */
  private followTick(): void {
    const rooms = this.layout().rooms;
    let newest: { ri: number; di: number; seq: number } | null = null;
    rooms.forEach((r, ri) => r.desks.forEach((d, di) => {
      const seq = d.desk.alert?.seq ?? 0;
      if (seq > this.followedSeq && (!newest || seq > newest.seq)) newest = { ri, di, seq };
    }));
    if (newest) {
      const n = newest as { ri: number; di: number; seq: number };
      this.followedSeq = n.seq;
      this.followHoldUntil = Date.now() + 6000;
      this.focusDesk(n.ri, n.di);
      return;
    }
    if (Date.now() < this.followHoldUntil || Date.now() - this.followLastMove < 6000) return;
    const busy: { ri: number; di: number }[] = [];
    rooms.forEach((r, ri) => r.desks.forEach((d, di) => {
      if (d.desk.agents.some((a) => a.status === 'working' || a.status === 'waiting')) busy.push({ ri, di });
    }));
    if (!busy.length) {
      if (this.focused() !== null) this.resetView();
      this.spot.set(null);
      return;
    }
    const next = busy[this.followCursor++ % busy.length];
    this.focusDesk(next.ri, next.di);
  }

  /** Frames a desk up close. */
  focusDesk(ri: number, di: number): void {
    const r = this.layout().rooms[ri];
    const d = r?.desks[di];
    if (!d) return;
    const { w: sw, h: sh } = this.stageSize();
    const target = Math.min(this.fitFor(DESK_W * 3.6, DESK_D * 4.6, sw, sh), 2.6);
    this.center.set({ x: r.x + d.x + DESK_W / 2, y: r.y + d.y + DESK_D / 2 - 30 });
    this.zoom.set(Math.min(Math.max(target / this.fit(), 0.35), 6));
    this.focused.set(ri);
    this.spot.set(`${ri}/${di}`);
    this.followLastMove = Date.now();
  }

  private readMode(compact: boolean): '3d' | '2d' {
    try {
      const saved = localStorage.getItem('po.floorplan.mode');
      if (saved === '2d' || saved === '3d') return saved;
    } catch { /* default */ }
    return compact || (typeof window !== 'undefined' && window.innerWidth < 640) ? '2d' : '3d';
  }

  setMode(m: '3d' | '2d'): void {
    this.modeOverride.set(m);
    try { localStorage.setItem('po.floorplan.mode', m); } catch { /* stays in memory */ }
    if (m === '3d') setTimeout(() => this.measure());
  }

  private measure(): void {
    const el = this.stage()?.nativeElement;
    if (el) this.stageSize.set({ w: el.clientWidth || 900, h: el.clientHeight || 600 });
  }

  /** Rooms in a ring around the hub: a readable graph, without overlaps. */
  readonly layout = computed<Layout>(() => {
    const rooms = this.block().rooms;
    const sized = rooms.map((room) => {
      const n = room.desks.length;
      const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 1.3))));
      const rows = Math.max(1, Math.ceil(n / cols));
      const w = PAD * 2 + cols * DESK_W + (cols - 1) * GAP;
      const h = HEAD + PAD * 2 + rows * DESK_D + (rows - 1) * (GAP + 22);
      const desks = room.desks.map((desk, i) => ({
        desk, x: PAD + (i % cols) * (DESK_W + GAP), y: HEAD + PAD + Math.floor(i / cols) * (DESK_D + GAP + 22),
      }));
      const busy = room.desks.some((d) => d.agents.some((a) => a.status === 'working'));
      const waiting = room.desks.reduce((s, d) => s + d.agents.filter((a) => a.status === 'waiting').length, 0);
      return { room, w, h, desks, busy, waiting, alert: this.roomAlert(room) };
    });
    const n = sized.length;
    const maxDim = Math.max(...sized.map((r) => Math.max(r.w, r.h)), 1);
    const radius = n === 1 ? maxDim / 2 + HUB_R + 120 : Math.max((maxDim + 90) / (2 * Math.sin(Math.PI / n)), maxDim / 2 * 1.42 + HUB_R + 110);
    const placed = sized.map((r, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1) + (n === 2 ? Math.PI / 2 : 0);
      return { ...r, x: Math.cos(a) * radius - r.w / 2, y: Math.sin(a) * radius - r.h / 2 };
    });
    const minX = Math.min(-HUB_R, ...placed.map((r) => r.x)) - 60;
    const minY = Math.min(-HUB_R, ...placed.map((r) => r.y)) - 90;
    const maxX = Math.max(HUB_R, ...placed.map((r) => r.x + r.w)) + 60;
    const maxY = Math.max(HUB_R, ...placed.map((r) => r.y + r.h)) + 60;
    return {
      w: maxX - minX, h: maxY - minY, hubX: -minX, hubY: -minY,
      rooms: placed.map((r) => ({ ...r, x: r.x - minX, y: r.y - minY })),
    };
  });

  /** Scale that fits the whole world in the scene, at the current rotation. */
  private fitFor(w: number, h: number, sw: number, sh: number): number {
    const r = (this.rot() * Math.PI) / 180;
    const t = (this.tilt() * Math.PI) / 180;
    const projW = w * Math.abs(Math.cos(r)) + h * Math.abs(Math.sin(r));
    const projH = (w * Math.abs(Math.sin(r)) + h * Math.abs(Math.cos(r))) * Math.cos(t) + 60;
    return Math.min((sw * 0.95) / projW, (sh * 0.86) / projH);
  }

  private readonly fit = computed(() => {
    const { w, h } = this.layout();
    const { w: sw, h: sh } = this.stageSize();
    return Math.min(this.fitFor(w, h, sw, sh), 1.6);
  });

  readonly scale = computed(() => this.fit() * this.zoom());
  /** Labels and signs keep a readable size even from afar. */
  readonly labelScale = computed(() => Math.min(Math.max(0.95 / this.scale(), 0.5), 3.2).toFixed(3));

  readonly worldTransform = computed(() => {
    const { w, h } = this.layout();
    const c = this.center() ?? { x: w / 2, y: h / 2 };
    const sh = this.stageSize().h;
    return `translateY(${-sh * 0.05}px) scale(${this.scale().toFixed(4)}) rotateX(${this.tilt()}deg) rotateZ(${this.rot()}deg) translate(${-c.x}px, ${-c.y}px)`;
  });

  /** Movement on screen → movement on the floor (inverse of scale, tilt and rotation). */
  private toWorld(dx: number, dy: number, s = this.scale()): { x: number; y: number } {
    const r = (this.rot() * Math.PI) / 180;
    const t = (this.tilt() * Math.PI) / 180;
    const ux = dx / s;
    const uy = dy / (s * Math.max(Math.cos(t), 0.2));
    return { x: ux * Math.cos(r) + uy * Math.sin(r), y: -ux * Math.sin(r) + uy * Math.cos(r) };
  }

  private currentCenter(): { x: number; y: number } {
    const { w, h } = this.layout();
    return this.center() ?? { x: w / 2, y: h / 2 };
  }

  private panBy(dx: number, dy: number): void {
    const d = this.toWorld(dx, dy);
    const c = this.currentCenter();
    const { w, h } = this.layout();
    this.center.set({ x: Math.min(Math.max(c.x - d.x, 0), w), y: Math.min(Math.max(c.y - d.y, 0), h) });
  }

  sprites(d: FloorDesk) {
    return d.agents.slice(0, MAX_SPRITES);
  }

  /** Avatars in a row on the desk top: one or two rows of four. */
  spriteX(d: FloorDesk, i: number): number {
    const count = Math.min(d.agents.length, MAX_SPRITES);
    const row = Math.floor(i / 4);
    const inRow = Math.min(4, count - row * 4);
    const step = 22;
    return DESK_W / 2 - ((inRow - 1) * step) / 2 + (i % 4) * step;
  }

  spriteY(d: FloorDesk, i: number): number {
    const rows = Math.ceil(Math.min(d.agents.length, MAX_SPRITES) / 4);
    return rows === 1 ? DESK_D * 0.62 : (Math.floor(i / 4) === 0 ? DESK_D * 0.42 : DESK_D * 0.82);
  }

  logo(provider: string): string {
    return PROVIDER_LOGO[provider] ?? 'assets/providers/terminal.svg';
  }

  statusLabel(s: string): string {
    const key = ({ working: 'Working', waiting: 'Waiting', idle: 'Idle', standby: 'Standby', error: 'Error', off: 'Stopped' } as Record<string, string>)[s];
    return key ? this.translate.instant('SESSIONS.FLOOR_PLAN.Canvas.Status.' + key) : s;
  }

  canOpen(d: FloorDesk): boolean {
    return !!d.session && this.openable().has(d.session);
  }

  isCurrent(d: FloorDesk): boolean {
    const id = this.activeSession();
    return !!id && (d.session === id || !!d.members?.includes(id));
  }

  open(d: FloorDesk, ev: Event): void {
    ev.stopPropagation();
    if (this.suppressClick) return;
    if (this.canOpen(d)) {
      this.hovered.set(null);
      this.openDesk.emit(d);
    }
  }

  hoverDesk(desk: FloorDesk, room: string, e: PointerEvent): void {
    if (this.drag?.moved) return;
    const el = this.stage()?.nativeElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const x = e.clientX - box.left + 16;
    const y = e.clientY - box.top + 16;
    this.hovered.set({ desk, room, x: Math.min(x, box.width - 260), y: Math.min(y, box.height - 40 - 22 * Math.min(desk.agents.length, 16) - 70) });
  }

  /** Frames a room: center on the room and zoom that fits it in the scene. */
  focusRoom(i: number): void {
    const r = this.layout().rooms[i];
    if (!r) return;
    const { w: sw, h: sh } = this.stageSize();
    const target = Math.min(this.fitFor(r.w + 120, r.h + 180, sw, sh), 2.4);
    this.center.set({ x: r.x + r.w / 2, y: r.y + r.h / 2 - 20 });
    this.zoom.set(Math.min(Math.max(target / this.fit(), 0.35), 6));
    this.focused.set(i);
  }

  onRoomClick(i: number, e: Event): void {
    e.stopPropagation();
    if (this.suppressClick || this.focused() === i) return;
    this.focusRoom(i);
  }

  rotateBy(deg: number): void {
    this.rot.update((r) => Math.min(Math.max(r + deg, 2), 88));
  }

  /** Zoom towards a point of the scene (the pointer), or towards the center. */
  zoomAt(f: number, clientX?: number, clientY?: number): void {
    const s0 = this.scale();
    const z = Math.min(Math.max(this.zoom() * f, 0.35), 6);
    const s1 = this.fit() * z;
    const el = this.stage()?.nativeElement;
    if (el && clientX !== undefined && clientY !== undefined) {
      const box = el.getBoundingClientRect();
      const off = this.toWorld(clientX - box.left - box.width / 2, clientY - box.top - box.height / 2 + box.height * 0.05, s0);
      const c = this.currentCenter();
      const k = 1 - s0 / s1;
      this.center.set({ x: c.x + off.x * k, y: c.y + off.y * k });
    }
    this.zoom.set(z);
  }

  resetView(): void {
    this.spot.set(null);
    this.rot.set(DEFAULT_ROT);
    this.tilt.set(DEFAULT_TILT);
    this.zoom.set(1);
    this.center.set(null);
    this.focused.set(null);
  }

  onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    this.suppressClick = false;
    this.drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, rot: this.rot(), tilt: this.tilt(), moved: false, id: e.pointerId, turn: e.button === 2 || e.shiftKey };
  }

  onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    if (!d.moved) {
      d.moved = true;
      this.following.set(false);
      this.spot.set(null);
      this.dragging.set(true);
      this.hovered.set(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (d.turn) {
      // Limited rotation: the north and west walls stay at the back, always behind the desks.
      this.rot.set(Math.min(Math.max(d.rot - (e.clientX - d.x) * 0.25, 2), 88));
      this.tilt.set(Math.min(Math.max(d.tilt - (e.clientY - d.y) * 0.2, 25), 70));
    } else {
      this.panBy(e.clientX - d.lastX, e.clientY - d.lastY);
      this.focused.set(null);
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  }

  onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    this.dragging.set(false);
    if (d.moved) {
      // The click that ends a drag does not open the desk or the room under the pointer.
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
    }
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.following.set(false);
    // Trackpad pinch = ctrl+wheel: same thing, finer.
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    this.zoomAt(f, e.clientX, e.clientY);
  }

  onDbl(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('.fp-desk')) return;
    this.resetView();
  }

  onKey(e: KeyboardEvent): void {
    const step = 80;
    if (e.key !== 'f' && e.key !== 'F') this.following.set(false);
    switch (e.key) {
      case 'ArrowLeft': this.panBy(step, 0); break;
      case 'ArrowRight': this.panBy(-step, 0); break;
      case 'ArrowUp': this.panBy(0, step); break;
      case 'ArrowDown': this.panBy(0, -step); break;
      case '+': case '=': this.zoomAt(1.25); break;
      case '-': case '_': this.zoomAt(0.8); break;
      case 'q': case 'Q': this.rotateBy(-15); break;
      case 'e': case 'E': this.rotateBy(15); break;
      case '0': this.resetView(); break;
      case 'f': case 'F': this.toggleFollow(); break;
      default: return;
    }
    e.preventDefault();
  }
}
