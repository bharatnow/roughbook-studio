<section>
    <h2>Plans</h2>
    <ul>
        @each('partials.plan', $plans ?? [['name' => 'Free', 'price' => '$0']], 'plan')
    </ul>
</section>
