export default {
    name: 'posh-pusher-watch',
    description: 'Reference Lobster pipeline stub for monitoring Poshmark offer pages.',
    steps: [
        {
            id: 'open-offers-page',
            action: 'goto',
            target: 'https://poshmark.com/offers',
        },
        {
            id: 'extract-offers',
            action: 'extract',
            description: 'Collect listing and buyer details for new offers.',
        },
        {
            id: 'notify-server',
            action: 'http_post',
            target: 'http://127.0.0.1:3456/notify',
        },
    ],
}