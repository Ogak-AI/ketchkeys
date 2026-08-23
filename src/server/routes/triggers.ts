import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { APP_NAME } from '../../shared/config';
import {
  createPost,
  isAsciiCommunityTitle,
  makeCommunityPostPublic,
} from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>().catch(() => ({ type: 'AppInstall' }));

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `${APP_NAME} post is ready in r/${context.subredditName} (${post.id}) — ${input.type}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Could not make the first post',
      },
      400
    );
  }
});

type PostTriggerBody = {
  type?: string;
  post?: { id?: string; title?: string };
};

/** Approve conversion posts so they appear in the public r/ketchkeys feed. */
triggers.post('/make-ascii-public', async (c) => {
  try {
    const body = await c.req.json<PostTriggerBody>().catch(() => ({}) as PostTriggerBody);
    const postId = body.post?.id;
    const title = body.post?.title;
    if (!postId || !isAsciiCommunityTitle(title)) {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const result = await makeCommunityPostPublic(postId);
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: result.public
          ? `Approved ${postId} for the public feed`
          : `Tried to approve ${postId}`,
      },
      200
    );
  } catch (error) {
    console.error('make-ascii-public trigger failed:', error);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Could not show the post in the public feed',
      },
      400
    );
  }
});
