# User Stories

_During our first meeting we collected a few different user stories. We are looking to more elaborated and structured stories that should be considered._

We list here source for inspiration and discussion:

- [Reddit discussion on multi user collaborative notebook](https://www.reddit.com/r/datascience/comments/i5hj2o/multi_user_collaborative_notebook)
- Paper published by acm.org in November 2019 on Data Scientist RTC [^f1].

The following sections surface topics we have discussed.

## Shared Kernel

Once you have multiple users editing the same notebook, one fundamental question is if each user has their own kernel or not. In some ways, it's more intuitive if they have the same because as you can re-use state between kernels easily and the normal model is to have one kernel per notebook. However, it is also then easy to clobber each other's work. The simpler model to implement is one kernel per notebook, but it might be worth thinking about how to support the other as well.

## Remote Resources

So far, we have been focusing on the multiple users, single server issue, but there is also the inverse, multiple servers, single user problem. In this context, you might have a variety of computational resources available to you in different platforms and have to switch between them. So it might be worth thinking about how real time data model could enable connecting to multiple servers at once or easily switching between them.

## Permissions

Once you start sharing notebooks, you often don't want everyone to have all the same access. At the most fine grained, you could want POSIX style permissions for each cell in a notebook.

## Chat

Also, once you are collaborating you will need other side channels, like a chat, to keep in sync and coordinate outside the document.

[^f1]: How Data Scientists Use Computational Notebooks for Real-Time Collaboration

    - [Article](https://dl.acm.org/doi/10.1145/3359141)
    - [Presentation](https://ipitweb.files.wordpress.com/2019/06/wang_ipit-1.pdf)
