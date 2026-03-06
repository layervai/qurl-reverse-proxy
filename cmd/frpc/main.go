// Copyright 2016 fatedier, fatedier@gmail.com
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/OpenNHP/nhp-frp/pkg/version"
	"github.com/OpenNHP/opennhp/endpoints/agent"
	"github.com/fatedier/frp/cmd/frpc/sub"
	"github.com/fatedier/frp/pkg/util/system"
)

const (
	colorReset  = "\033[0m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
)

func nhpAgentStart(waitCh chan error) {
	exeFilePath, err := os.Executable()
	if err != nil {
		waitCh <- err
		return
	}
	exeDirPath := filepath.Dir(exeFilePath)

	a := &agent.UdpAgent{}

	err = a.Start(exeDirPath, 4)
	if err != nil {
		fmt.Printf("\n  %s❌ Failed to start agent:%s %v\n\n", colorYellow, colorReset, err)
		waitCh <- err
		return
	}

	a.StartKnockLoop()
	// react to terminate signals
	termCh := make(chan os.Signal, 1)
	signal.Notify(termCh, syscall.SIGTERM, os.Interrupt, syscall.SIGABRT)

	// block until terminated
	waitCh <- nil
	<-termCh

	fmt.Printf("\n  %s🛑 Shutting down agent...%s\n", colorYellow, colorReset)
	a.Stop()
	fmt.Printf("  %s✅ Agent stopped gracefully%s\n\n", colorGreen, colorReset)
}

func main() {
	waitCh := make(chan error)
	go nhpAgentStart(waitCh)
	err := <-waitCh
	if err != nil {
		fmt.Printf("nhp agent start error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("nhp agent started successfully\n")
	fmt.Printf("%s\n", version.Short())

	system.EnableCompatibilityMode()
	sub.Execute()
}
