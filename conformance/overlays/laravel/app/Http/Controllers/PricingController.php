<?php

namespace App\Http\Controllers;

class PricingController extends Controller
{
    public function index()
    {
        $plans = [
            ['name' => 'Free', 'price' => '$0'],
            ['name' => 'Team', 'price' => '$12'],
            ['name' => 'Business', 'price' => '$29'],
        ];

        return view('pricing', ['plans' => $plans]);
    }
}
