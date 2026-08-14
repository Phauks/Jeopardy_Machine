<script lang="ts">
  // One player's identity mark at chip sizes: the sprite on an accent-colored round backing.
  // This is the 24px story from the avatar proof - at score-chip size the accent backing
  // carries "which player/team", the sprite only has to read as "which avatar"; from 48px up
  // the sprite itself is fully legible. The backing darkens the accent (color-mix toward
  // near-black) so the accent-recolored body still separates from its own backing.
  // Presentational only: everything arrives via props, sizing rides on one CSS length.
  import type { AvatarAccent, AvatarEntry } from "#lib/avatars/avatar-manifest.ts";
  import { avatarSpriteUrl } from "#lib/avatars/avatar-manifest.ts";

  type Props = {
    avatar: AvatarEntry;
    accent: AvatarAccent;
    /** CSS length for the chip diameter; the default is the 24px score-chip size. */
    size?: string;
  };
  let { avatar, accent, size = "24px" }: Props = $props();
</script>

<span
  class="avatar-chip"
  style="--avatar-chip-size: {size}; --avatar-chip-accent: {accent.hex}"
  title={avatar.displayName}
>
  <img src={avatarSpriteUrl(avatar, accent.id)} alt={avatar.displayName} draggable="false" />
</span>

<style>
  .avatar-chip {
    width: var(--avatar-chip-size);
    height: var(--avatar-chip-size);
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: color-mix(in oklab, var(--avatar-chip-accent) 55%, #14141c);
    box-shadow: inset 0 0 0 max(1px, calc(var(--avatar-chip-size) / 24))
      color-mix(in oklab, var(--avatar-chip-accent) 60%, white);
  }

  img {
    width: 88%;
    height: 88%;
    display: block;
    user-select: none;
  }
</style>
