import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { APP_NAME } from '../../shared/config';
import { createPost, postCommentsUrl } from '../core/post';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: postCommentsUrl(context.subredditName, post.id),
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: `Could not make the ${APP_NAME} post`,
      },
      400
    );
  }
});
